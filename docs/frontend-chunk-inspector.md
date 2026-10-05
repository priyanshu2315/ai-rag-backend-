# Frontend GPT prompt: inspect the complete document pipeline

Implement a detailed pipeline inspector in my existing frontend. Read its architecture first and reuse its API client, authentication, components, and styles. This document describes the implemented backend contract. Build against real data, and keep the normal document/chat interface working.

## What the backend now does

- Extracts page text/Markdown, recognizes headings, and keeps section breadcrumbs across page changes.
- Splits each page's section content into parents, then children. A section can span pages; an individual parent currently belongs to one page.
- Uses parent size 1,200 characters/overlap 200; child size 400 characters/overlap 50.
- Stores raw `text` separately from `searchText`, which prefixes the document filename and section breadcrumb.
- Embeds child `searchText` with `Xenova/all-MiniLM-L6-v2`, producing 384-dimensional vectors. It checks the complete labelled input against its configured token limit before embedding.
- Connects previous/next parents within the same document and section, including across pages.
- Prepares all chunks and embeddings, then commits them together. Preparation events do not mean records are already saved.
- Makes questions available after saving chunks. Summary processing finishes separately.
- Searches contextual children with vector and keyword search, returns parent candidates, reranks parents, deduplicates by parent ID, adds immediate same-section neighbors, grades the expanded collection, and generates from contextual passages.
- Exposes stored chunk details through authenticated inspection endpoints and detailed live SSE events. Document processing events are cached in Redis for 24 hours after the most recent event and replayed on reconnect. Saved chunks remain available through the REST endpoints after event history expires.
- Prints full pipeline detail events in the backend terminal by default. `RAG_DEBUG=false` disables the new verbose terminal logs, not the frontend events.

The database reset/migration and Prisma Client generation are complete. Old accounts and document records were cleared. No migration is needed for these visibility additions.

## Authentication and common response rules

Use the application's existing backend base URL. Every endpoint below requires `Authorization: Bearer <JWT>`. Inspection endpoints and document progress are restricted to the document owner. Send GET requests without a body.

REST successes use `success: true` and `data`. Inspection failures use `success: false` and `error`. Handle authentication failures through the existing login flow. A 404 can mean missing data or a document/parent that does not belong to this user. While chunks are only prepared, a parent may not exist in REST yet.

## 1. Upload request and response

POST `/api/documents/upload`

Request: multipart form data, field `file`. Let the browser set the multipart boundary.

HTTP 202 response example (IDs are illustrative):

```json
{
  "success": true,
  "message": "Document uploaded and queued for AI processing",
  "data": {
    "id": "document-uuid",
    "filename": "school-handbook.pdf",
    "createdAt": "2026-10-04T12:00:00.000Z",
    "fileUrl": "https://example.com/school-handbook.pdf",
    "status": "PROCESSING",
    "summaryStatus": "PENDING",
    "summary": null,
    "userId": "user-uuid"
  }
}
```

Immediately connect to this document's progress stream. Do not treat HTTP 202 as processing completion.

## 2. Document list and readiness

GET `/api/documents/my-documents`

Response: `{ "success": true, "data": [DocumentListItem] }`.

Each item contains `id`, `filename`, `createdAt`, `fileUrl`, `status`, `summaryStatus`. It does not include the saved summary text.

- Enable questions when `status` is `COMPLETED`.
- Enable summary requests when `summaryStatus` is `COMPLETED`.
- Keep questions enabled if the summary fails.
- Recover these states from this endpoint on refresh/reconnect.

## 3. Stored parent response

GET `/api/documents/get-all-parent-chunk/:docId`

Response example:

```json
{
  "success": true,
  "data": [
    {
      "id": "parent-uuid",
      "documentId": "document-uuid",
      "text": "Late pickup must be reported to the school office.",
      "searchText": "Document: school-handbook.pdf\nSection: School handbook > Late pickup\n\nLate pickup must be reported to the school office.",
      "prevParentId": null,
      "nextParentId": "next-parent-uuid",
      "totalChildren": 1,
      "metadata": {
        "page_number": 1,
        "source_pages": [1],
        "chunk_index": 0,
        "document_title": "school-handbook.pdf",
        "heading_path": ["School handbook", "Late pickup"],
        "section_id": "section-2",
        "section_part_index": 0,
        "chunker_version": "section-context-v1"
      }
    }
  ]
}
```

Call the object above `Parent` in your frontend types. The endpoint orders parents by global `metadata.chunk_index`, which starts at zero.

## 4. Stored child response

GET `/api/documents/get-all-child-chunk/:parentId`

The exact response shape is:

| Field | Type / meaning |
|---|---|
| `success` | `true` |
| `data.parentId` | Parent UUID |
| `data.documentId` | Document UUID |
| `data.parentText` | Raw parent passage; retained for existing UI compatibility |
| `data.parent` | Complete `Parent` object, including `searchText`, links, metadata, and `totalChildren` |
| `data.totalChildren` | Number of children returned |
| `data.children` | Array of `Child` objects, ordered by `metadata.child_index` |

Every `Child` object contains:

| Field | Type / meaning |
|---|---|
| `id` | Child UUID |
| `parentId` | Parent UUID |
| `documentId` | Document UUID |
| `text` | Raw child passage |
| `searchText` | Exact stored contextual passage used for embedding/search |
| `metadata` | Parent metadata plus `child_index` and `embedding` diagnostics |
| `embedding` | Array of 384 real stored numbers; not a string |
| `embeddingDimensions` | `384` |

`metadata.embedding` on newly processed children has this shape:

```json
{
  "model": "Xenova/all-MiniLM-L6-v2",
  "tokenCount": 37,
  "tokenLimit": 256,
  "withinLimit": true,
  "dimensions": 384
}
```

The counts above are examples; display the actual response values. `tokenLimit` comes from the backend check. Do not assume character count equals token count. A failed embedding diagnostic has no `dimensions`, since no vector was produced.

Show the actual vector in a collapsed numeric viewer with indices 0–383 and a copy action. Do not fabricate embedding values. Load children when the user expands a parent; do not fetch all vectors for every document at startup.

## 5. Document-processing SSE contract

GET `/api/documents/progress/:docId`

Response content type: `text/event-stream`. Frames are `data: <JSON>` followed by a blank line. Use an authenticated streaming request, not a native EventSource that cannot send the application's bearer header.

Every document event has `type`, `documentId`, `eventId` (UUID), and `timestamp` (ISO UTC). These are inside the JSON data; the server does not use SSE `id:` fields. The additional fields below are exact:

| `type` | Additional payload fields |
|---|---|
| `extraction_start` | `jobId` |
| `page_extracted` | `page`, `totalPages`, `text`, `textLength` |
| `chunking_start` | `documentTitle`, `totalPages`, `chunkerVersion`, `parentChunkSize`, `parentChunkOverlap`, `childChunkSize`, `childChunkOverlap`, `sizeUnit` (`characters`) |
| `heading_detected` | `page`, `lineNumber`, `text`, `title`, `level`, `format` (`markdown`, `bold`, or `numbered_uppercase`), `repeated` (boolean) |
| `code_fence` | `page`, `lineNumber`, `text`, `insideCodeBlock` (boolean after toggling the fence) |
| `section` | `sectionId`, `headingPath`, `page` (starting page), `stage` (`preparing`) |
| `section_part` | `sectionId`, `headingPath`, `page`, `partIndex`, `text`, `textLength`, `stage` (`preparing`) |
| `parent_created` | `parent` (a `Parent` object), `stage` (`preparing`) |
| `child_created` | `child` (`id`, `parentId`, `documentId`, `text`, `searchText`, `metadata`), `stage` (`preparing`) |
| `parent_links` | `sectionId`, `parentId`, `prevParentId`, `nextParentId`, `stage` (`preparing`) |
| `chunking_complete` | `stage` (`preparing`), `totalPages`, `totalSections`, `totalParents`, `totalChildren`, `sections` |
| `page_start` | `page`, `totalPages` |
| `parent` | `page`, `parent` (1-based page-local number), `parentId`, `preview`, `stage` (`preparing`), `sectionId`, `headingPath`, `text`, `searchText`, `metadata`, `prevParentId`, `nextParentId`, `totalChildren` |
| `embedding_start` | `parentId`, `childId`, `searchText`, `searchTextLength` |
| `embedding_failed` | `parentId`, `childId`, `embeddingDetails` when available, `message` |
| `child` | `page`, `parent` (1-based number), `child` (1-based number), `totalChildren`, `stage` (`preparing`), `parentId`, `childId`, `text`, `searchText`, `metadata`, `embeddingDetails` |
| `saving_chunks` | `totalParents`, `totalChildren` |
| `chunks_saved` | `stage` (`saved`), `totalParents`, `totalChildren` |
| `chunks_ready` | No required additional fields |
| `summarizing` | No required additional fields |
| `completed` | No required additional fields |
| `failed` | Optional `message` |
| `summary_failed` | Optional `message` |

`chunking_complete.sections` is an array of `{id, headingPath, sourcePages, totalParents, totalChildren}`. It includes detected sections with no body/parents. `embeddingDetails` uses the same shape as `metadata.embedding` above. Live events contain dimensions/diagnostics, not the full numeric vector; vectors come from the child REST endpoint after saving.

Example section event:

```json
{
  "type": "section",
  "documentId": "document-uuid",
  "eventId": "event-uuid",
  "timestamp": "2026-10-04T12:00:01.000Z",
  "sectionId": "section-2",
  "headingPath": ["School handbook", "Late pickup"],
  "page": 1,
  "stage": "preparing"
}
```

Replay/merge rules:

- Opening/reconnecting to progress replays available history, then sends live events. Deduplicate by `eventId` client-side too.
- Identify sections with document ID plus section ID; identify parents/children by their UUIDs. Update existing entries instead of adding duplicates.
- A `parent_created` event initially has null links; `parent_links` supplies the computed links later. Merge those updates without discarding text/metadata.
- `child_created` means the passage exists in memory. `child` means its embedding finished in memory. Neither means the record has been committed.
- `chunking_complete` means splitting finished, not that questions are available.
- On `chunks_ready`, fetch saved parents and enable questions. Keep progress streaming while the summary runs.
- Close the client stream on `completed`, `failed`, or `summary_failed`; otherwise an auto-reconnecting client can reopen a finished stream unnecessarily.
- After Redis history expires, rebuild saved section groups from parent metadata and fetch children on expansion. Original extracted-page events and empty heading-only sections are not separately persisted in PostgreSQL; do not pretend they were recovered from REST.

## 6. Question request and detailed search SSE

POST `/api/chat` with JSON body:

```json
{
  "question": "What must a parent do if pickup is late?",
  "documentId": "document-uuid",
  "conversationId": "conversation-uuid"
}
```

Use the existing conversation flow to obtain `conversationId`. For all-document search, `documentId` can be null. Do not send `userId`; the server takes it from authentication.

The response is SSE. Keep support for existing `status` (`message`), `tool_start` (`tool`, `query`), `tool_finish` (`tool`, `message`), `token` (`text`), `done`, and `error` (`message`) events.

Graph events also include `eventId` and `timestamp`; service-level token/done/status events need not include them. Associate events with the frontend's current question/request.

Additional implemented structured events:

| `type` | Payload fields |
|---|---|
| `retrieval_candidates` | `attempt` (1-based), `query`, `documents` (candidate parent array) |
| `rerank_result` | `attempt`, `query`, `documents` (selected parent array in reranker order) |
| `neighbor_expansion` | `attempt`, `seedParentIds`, `addedParentIds`, `documents` (expanded array) |
| `grading_result` | `attempt`, `decisionSource`, `keptParentIds`, `decisions` |
| `generation_context` | `intent`, `documents`, `contextText` (exact assembled document-source context) |

Search parent objects contain `id`, `documentId`, `text`, `searchText`, `prevParentId`, `nextParentId`, `metadata`. Candidates additionally contain numeric `retrievalScore` (combined rank-fusion score). Reranked parents additionally contain numeric `rerankScore` (Cohere relevance score). Search trace objects do not contain `totalChildren`; get that from inspection REST when needed.

After neighbor expansion, `retrievalOrigin` is `{type: "search"}` for seeds or `{type: "neighbor", seedParentId, direction: "previous" | "next"}` for newly added neighbors. Neighbor-only objects do not have a rerank/retrieval score; display that accurately.

Each grading decision is `{parentId, documentId, page, sectionId, relevant}`. `decisionSource` is `model` or `grader_error_fallback`. The grader does not supply explanations; do not invent reasons. An empty search skips the grading detail event because there are no chunks to grade.

The Question Splitter's `tool_finish` event also includes `queries` (string array). The Intent Classifier's `tool_finish` includes `intent` and `pageNumber`. Query Rewriter's `tool_finish` includes `query` (rewritten string).

`generation_context` for a summary uses a summary object with `text` and `metadata.page_number: "Summary"`; it is not a stored parent and has no parent UUID. Greeting/empty-result contexts can have an empty `documents` array.

Show candidate parents, selected parents, added neighbors, kept/dropped decisions, scores, and the final source context. Link real parent IDs to the inspector. These are parent-level results; the backend does not emit individual matched-child rankings/distances.

## Required frontend views

1. Document overview: filename/ID, chunk and summary status, source-page/section/parent/child counts, and actual splitter settings.
2. Processing timeline: all actual events, timestamps, stage, expandable exact JSON, preparation versus embedding versus saving versus summary.
3. Source pages: extracted text plus detected headings, heading levels/formats, repeated headers, and code-fence decisions when replay is available.
4. Section tree: breadcrumbs, ID, represented pages, page-parts, and parent/child totals. Keep empty detected sections visible when reported.
5. Parent detail: ID, section, page, zero-based chunk/part indices, complete raw and contextual text side by side, metadata, and real previous/next links. Clicking a cross-page link navigates to that parent.
6. Child detail: ID, parent ID, index/page, complete raw/contextual text, embedding model, actual token count/limit, vector dimension, and expandable full vector.
7. Search inspector beside each answer: queries/attempts, candidates, reranked selections, neighbor additions with originating parent/direction, grading decisions, and final context.
8. Filters for page/section, text/ID search, copy actions, loaded-versus-total counts, loading/error states, and an advanced-inspector toggle that keeps the ordinary chat UI understandable.

Preserve text and tables in the text viewers. Render document content as data, not executable HTML. Treat JSON snapshots as authoritative; do not invent missing progress percentages, scores, vectors, links, or grader explanations. Display timestamps in the user's local timezone while keeping the original ISO timestamp in JSON.

## Acceptance checks

- Upload a fresh document with one section continuing across two pages. Verify the continuation retains its breadcrumb in both parent and child `searchText`.
- Follow the actual previous/next IDs across the page boundary, and verify links stop at a new section.
- Inspect the actual stored child vector and embedding diagnostics after saving.
- Connect late/reconnect during processing: events should replay without duplicated sections/parents/children or inflated counters.
- Verify questions become available before summary completion and stay available after summary failure.
- Ask a question: inspect actual candidates, reranking, added neighbors, grading, and contextual text used for the answer.
- Refresh after completion: recover statuses and saved chunks from REST, and replay history while its 24-hour retention remains available.
- Confirm the inspection requests send the bearer token; another user's document/parent must not be displayed.

## Current limitations to represent accurately

The document label is still the filename; a title/entity mentioned only once is not reliably extracted as global context. Bold sentences can be misclassified as headings. Oversized labelled children fail instead of being resized. Tables still use character splitting. Sections/source extraction events are temporary history, not a separate Section database model. An older migration deletes the vector-search index; that performance issue remains separate from this inspector work.

Deliver the frontend implementation and summarize what was verified with real API responses. Do not claim that implementing this inspector fixes these chunking/retrieval limitations.
