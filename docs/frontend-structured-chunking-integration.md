# Frontend integration prompt: structured chunking and live progress

Backend implementation date: **6 October 2026**. Contract checked against the backend on **7 October 2026**.

Copy the prompt below into the frontend coding assistant. Live progress has **no server-side replay**. After refresh, restore saved chunks through REST and clearly mark unavailable extraction details.

---

Implement the frontend integration for our updated document ingestion and chunk inspector. Inspect the existing frontend first and use its current framework, components, API client, authentication, and state management.

Complete the implementation with working code and relevant tests. The backend changes are already implemented. Use the contract below; do not invent endpoints or require backend changes.

## 1. What changed in the backend

The active chunker is `structured-context-v4`.

```text
Extract and normalize sources
→ collect document identity and heading candidates
→ normalize section relationships
→ collect structural blocks
→ resolve supported table continuations and explicit references
→ build labelled structural units
→ pack parents and children within token budgets
→ embed children
→ save all chunks
→ expose document for questions
→ generate summary
```

Make these changes visible:

- Document identity is stored separately from section headings.
- Heading decisions expose original formatting, inferred hierarchy, reasons, warnings, and source evidence.
- Supported interrupted table pieces share a table identity.
- Explicit section references are separate from previous/next reading-order links.
- Table values carry column labels, dates, supported units, and definitions.
- Lists retain item identities; oversized items or rows may have fragments.
- Parents default to **1,024 tokens**.
- Children fit the lower of **256 tokens** and the embedding tokenizer limit.
- Token counts include the complete contextual input and special tokens.
- Long document/section prefixes may be compacted to stable IDs.
- Ambiguous structure remains visible through warnings and unresolved statuses.
- No generative AI call was added to chunk creation. Extraction uses LlamaParse for supported formats; embedding uses the local model.

Do not display character-based settings such as “parent size 1200, overlap 200, child size 400, overlap 50” as the current pipeline. Existing documents can contain older chunker versions; render available fields gracefully.

## 2. Authentication and API contracts

Use the existing API base URL. All endpoints below require:

```http
Authorization: Bearer <JWT>
```

Progress and chunk inspection check ownership.

### Upload

```http
POST /api/documents/upload
Content-Type: multipart/form-data
```

FormData field: `file`. Let the browser set the multipart boundary.

Success: HTTP `202`.

```ts
{
  success: true;
  message: "Document uploaded and queued for AI processing";
  data: {
    id: string;
    filename: string;
    createdAt: string;
    fileUrl: string | null;
    status: string;
    summaryStatus: string;
    summary: string | null;
    userId: string;
  };
}
```

Use `data.id` as `documentId`. Connect to progress immediately after receiving it. Some early events can occur before the connection opens; the backend does not replay them.

Upload errors currently use HTTP `400`:

```json
{
  "success": false,
  "error": "Error message"
}
```

### Current user’s documents

```http
GET /api/documents/my-documents
```

```ts
{
  success: true;
  data: Array<{
    id: string;
    filename: string;
    createdAt: string;
    fileUrl: string | null;
    status: string;
    summaryStatus: string;
  }>;
}
```

This response does not contain the summary text.

### Stored parents

```http
GET /api/documents/get-all-parent-chunk/:docId
```

```ts
{
  success: true;
  data: ParentChunk[];
}
```

Parents are returned ordered by `metadata.chunk_index`.

### Stored children

```http
GET /api/documents/get-all-child-chunk/:parentId
```

```ts
{
  success: true;
  data: {
    parentId: string;
    documentId: string;
    parentText: string;
    parent: ParentChunk;
    totalChildren: number;
    children: ChildChunk[];
  };
}
```

Children are ordered by `metadata.child_index`.

### Errors

Handle HTTP status and optional `error` text. Authentication errors may omit `success`:

```json
{
  "error": "Unauthorized: Invalid token"
}
```

Parent inspection returns `404` for an inaccessible or missing document. Child inspection returns `404` when its parent is not found.

## 3. Shared data contracts

Treat optional fields as optional at runtime. Preserve unknown fields for the raw JSON inspector. These interfaces describe relevant fields; they do not promise every historical document has them.

```ts
type SourceKind = "page" | "rendered_page" | "image" | "document";

interface SourceInfo {
  id: string;
  kind: SourceKind;
  sequenceIndex: number;
  parserPageNumber: number | null;
  sourcePageNumber: number | null;
  textFormat: "markdown" | "plain";
  warnings: string[];
}

interface SourceSpan {
  sourceId: string;
  startOffset: number;
  endOffset: number;
}

interface SourceLocation extends SourceSpan {
  sourceKind?: SourceKind;
  sequenceIndex?: number;
  sourcePageNumber?: number | null;
  parserPageNumber?: number | null;
  role?: string;
  scope?: string;
}

interface HeadingDecision {
  id: string;
  title: string;
  rawText: string;
  kind: string;
  originalLevel: number | null;
  numbering: {
    label: string;
    parts: string[];
    delimiter: string | null;
  } | null;
  locations: SourceLocation[];
  containers: string[];
  status: string;
  warnings: string[];
  role: string;
  parentCandidateId: string | null;
  depth: number | null;
  reasons: string[];
}

interface DocumentIdentity {
  version: "document-identity-v1";
  filename: string;
  title: string;
  titleSource: "opening_cover" | "filename_match" | "filename";
  status: "inferred" | "fallback";
  acceptedCandidateIds: string[];
  proposal: {
    status: string;
    text: string;
    parts: Array<{
      candidateId: string;
      text: string;
      kind: string;
      originalLevel: number | null;
      locations: SourceLocation[];
    }>;
  } | null;
  warnings: string[];
}

interface SectionStructure {
  version?: string;
  status: string;
  heading_candidate_ids?: string[];
  boundary: HeadingDecision | null;
  review_required: boolean;
}

interface TableRelationship {
  type: "table_continuation";
  status: "inferred" | "unresolved";
  blockId: string;
  tableId?: string;
  evidence?: string[];
  candidateTableIds?: string[];
  reason?: string;
}

interface ExplicitReference {
  sourceSectionId: string;
  targetSectionId: string | null;
  targetLabel: string;
  relation: "explains" | "references";
  status: "resolved" | "unresolved";
  reason?: string;
  evidence: {
    text: string;
    sourceSpan: SourceSpan;
  };
  targetParentIds?: string[];
}

interface TokenDetails {
  tokenCount: number;
  tokenLimit: number;
  withinLimit?: boolean;
  model?: string;
  dimensions?: number;
}

interface ChunkMetadata {
  page_number?: number | null;
  source_pages?: number[];
  source?: SourceInfo;
  source_locations?: SourceLocation[];
  context_locations?: SourceLocation[];
  extraction?: {
    schema_version: string;
    provider: string;
    job_id: string | null;
    warnings: string[];
  };
  document_title?: string;
  document_identity?: DocumentIdentity;
  heading_path?: string[];
  section_id?: string;
  section_structure?: SectionStructure;
  section_part_index?: number | null;
  section_part_span?: SourceSpan | null;
  reading_section_ids?: string[];
  chunk_index?: number;
  child_index?: number;
  chunker_version?: string;
  block_ids?: string[];
  source_unit_ids?: string[];
  block_types?: string[];
  table_ids?: string[];
  row_ids?: string[];
  list_item_ids?: string[];
  contains_unit_fragments?: boolean;
  context_compacted?: boolean;
  structure_warnings?: string[];
  relationships?: TableRelationship[];
  references?: ExplicitReference[];
  token_budget?: TokenDetails;
  embedding?: TokenDetails;
  [key: string]: unknown;
}

interface ParentChunk {
  id: string;
  documentId: string;
  text: string;
  searchText: string;
  metadata: ChunkMetadata | null;
  prevParentId: string | null;
  nextParentId: string | null;
  totalChildren: number;
}

interface ChildChunk {
  id: string;
  documentId: string;
  parentId: string;
  text: string;
  searchText: string;
  metadata: ChunkMetadata | null;
  // Present in stored-child REST responses, not live child events.
  embedding?: number[];
  embeddingDimensions?: number;
}
```

Interpretation rules:

- `text` is the rendered chunk passage. It can contain repeated table/list labels; it is not necessarily an exact original-source substring.
- `searchText` is the contextual input used for embedding/search. Show it separately.
- Original extracted text comes from live `page_extracted` and `section_part` events.
- `section_part_index` and `section_part_span` are **null in v4 chunk metadata**. Use source locations.
- `source_locations` describe passage evidence; `context_locations` describe supporting headers, definitions, and notes.
- `scope: "source_unit"` means a source span can cover more text than an individual split child. Do not promise exact child highlighting.
- Offsets are JavaScript UTF-16 string offsets: start inclusive, end exclusive.
- `page_number` is the primary source’s physical page when known.
- `source_pages` can include additional pages supplying headers or explanations.
- `parserPageNumber` for DOCX/rendered sources is not a physical PDF page.
- Section/table/block/row/list IDs are document-local. Scope them by `documentId`.
- Do not derive hierarchy from section IDs or assume `5A` automatically explains `5`.
- `targetParentIds` may exist even when a reference’s overall status is unresolved. Check status before presenting a confirmed semantic relationship.
- Parent token budgets are context budgets; parents are not embedded.
- Child `token_budget` and `embedding` are distinct: measured input budget versus completed embedding diagnostics.
- Identity marked `inferred` is not externally verified.
- A non-null identity proposal can still have `status: "unresolved"` even when some candidate IDs were adopted.

## 4. Live SSE transport

```http
GET /api/documents/progress/:docId
Authorization: Bearer <JWT>
Accept: text/event-stream
```

The backend writes unnamed SSE messages:

```text
data: {"type":"...","documentId":"...","eventId":"...","timestamp":"..."}

```

There is no SSE `event:` or `id:` field. Dispatch using the JSON payload’s `type`.

```ts
interface EventEnvelope {
  type: string;
  documentId: string;
  eventId: string;
  timestamp: string;
  stage?: string;
  [key: string]: unknown;
}
```

Use authenticated fetch streaming or the existing SSE library supporting Authorization headers. Native `EventSource` cannot attach this bearer header.

The parser must handle:

- Records split across reads and several records in one read.
- UTF-8 characters split across reads.
- LF or CRLF separators, SSE comments, and empty records.
- Malformed JSON without crashing the whole inspector.
- Abort/disconnect on navigation, logout, or document switch.

Use streaming `TextDecoder`, buffered SSE parsing, and `AbortController` cleanup.

## 5. Complete event payload map

The fields below supplement the common envelope. Not every event has `stage`.

| Event type | Additional payload |
|---|---|
| `extraction_start` | `jobId: string` |
| `extraction_complete` | `stage: "preparing"`, `schemaVersion`, `provider`, `parserJobId: string \| null`, `warnings: string[]`, `totalSources: number`, `totalPages: number \| null` |
| `page_extracted` | `stage: "preparing"`, `page: number \| null`, `source: SourceInfo`, `totalSources`, `totalPages`, `text`, `textLength`, `parserItemCount: number \| null` |
| `chunking_start` | `stage: "preparing"`, `documentTitle`, `chunkerVersion: "structured-context-v4"`, `sizeUnit: "tokens"`, `totalSources`, `totalPages` |
| `document_identity` | `stage: "preparing"`, `identity: DocumentIdentity` |
| `heading_decision` | `stage: "preparing"`, `page`, `source`, `decision: HeadingDecision` |
| `section` | `stage: "preparing"`, `sectionId`, `headingPath: string[]`, `structure: SectionStructure`, `page`, `source` |
| `section_part` | `stage: "preparing"`, `sectionId`, `headingPath`, `structure`, `page`, `source`, `sourceSpan: SourceSpan`, `partIndex: number`, `text`, `textLength` |
| `structure_resolved` | `stage: "preparing"`, `totalBlocks: number`, `totalUnits: number`, `tableContinuations: TableRelationship[]`, `references: ExplicitReference[]`, `warnings: string[]` |
| `parent_created` | `stage: "preparing"`, `parent: ParentChunk`; children omitted, `totalChildren` included |
| `child_created` | `stage: "preparing"`, `child: ChildChunk`; vector and completed embedding diagnostics not yet available |
| `parent_links` | `stage: "preparing"`, `sectionId`, `parentId`, `prevParentId`, `nextParentId` |
| `chunking_complete` | `stage: "preparing"`, `totalSources`, `totalPages`, `totalSections`, `totalParents`, `totalChildren`, `sections: SectionSummary[]` |
| `page_start` | `page`, `source`, `totalSources`, `totalPages` |
| `parent` | `stage: "preparing"`, `source`, `page`, `parent: number`, `parentId`, `preview`, `sectionId`, `headingPath`, `text`, `searchText`, `metadata`, `prevParentId`, `nextParentId`, `totalChildren` |
| `embedding_start` | `parentId`, `childId`, `searchText`, `searchTextLength` |
| `embedding_failed` | `parentId`, `childId`, optional `embeddingDetails: TokenDetails`, `message` |
| `child` | `stage: "preparing"`, `page`, `parent: number`, `source`, `child: number`, `totalChildren`, `parentId`, `childId`, `text`, `searchText`, `metadata`, `embeddingDetails: TokenDetails` |
| `chunking_failed` | `stage: "preparing"`, `code`, `message`, `details: object \| null` |
| `saving_chunks` | `totalParents`, `totalChildren` |
| `chunks_saved` | `stage: "saved"`, `totalParents`, `totalChildren` |
| `chunks_ready` | No additional required fields |
| `summarizing` | No additional required fields |
| `completed` | No additional required fields |
| `summary_failed` | Optional `message` |
| `failed` | Optional `message` |

```ts
interface SectionSummary {
  id: string;
  headingPath: string[];
  structure: SectionStructure;
  sourcePages: number[];
  sourceIds: string[];
  totalParents: number;
  totalChildren: number;
}
```

Event rules:

- `parent` and `child` numbers are one-based display ordinals. Metadata indices are zero-based. Parent ordinals restart per primary source.
- `parent_created` and `parent` describe the same parent at different stages.
- `child_created` and `child` describe the same child before and after embedding.
- Upsert entities by ID; do not count these as different chunks.
- Keep each distinct event in the timeline, deduplicating repeated delivery by `eventId`.
- `chunking_complete.sections` summarizes sections represented in chunks. Earlier `section` events may include sections with no final chunks.
- `structure_resolved.warnings` is not a complete warning aggregate. Inspect decisions, metadata, relationships, and source warnings too.
- `structure_resolved` does not include complete block or structural-unit objects. Do not fabricate their full content.
- The backend does not emit detailed summary-batch progress.
- Live `child` events do not transmit vectors. Fetch them from stored-child REST after persistence.

Typical sequence:

```text
extraction_start
extraction_complete
page_extracted × sources
chunking_start
document_identity
heading_decision × candidates
section / section_part
structure_resolved
parent_created / child_created / parent_links
chunking_complete
page_start / parent / embedding_start / child
saving_chunks
chunks_saved
chunks_ready
summarizing
completed OR summary_failed
```

Errors can interrupt this sequence.

Example continuation diagnostics (IDs are illustrative):

```json
{
  "type": "table_continuation",
  "status": "inferred",
  "blockId": "block-example",
  "tableId": "table-1",
  "evidence": [
    "ADJACENT_SOURCE",
    "COMPATIBLE_COLUMN_COUNT",
    "CONSECUTIVE_ROW_IDS"
  ]
}
```

```json
{
  "type": "table_continuation",
  "status": "unresolved",
  "blockId": "block-example",
  "candidateTableIds": ["table-1", "table-2"],
  "reason": "AMBIGUOUS_TABLE_MATCH"
}
```

## 6. Readiness and persistence state

```ts
type IngestionStatus = "PROCESSING" | "COMPLETED" | "FAILED";
type SummaryStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
```

Use separate ingestion and summary indicators:

- `parent_created`, `child_created`, `parent`, `child`, and `chunking_complete`: prepared in memory.
- Successful `child`: embedding succeeded; not yet saved.
- `saving_chunks`: saving started.
- `chunks_saved`: transaction completed.
- `chunks_ready`: ingestion completed; questions can run.
- `summarizing`: summary processing.
- `completed`: summary completed.
- `summary_failed`: summary failed; ingestion remains completed and chunks remain usable.
- `failed`: ingestion failed.

Do not require summary completion to enable document questions.

`chunking_failed` and `embedding_failed` are diagnostics, followed by the worker’s terminal `failed` event. Retain their specific details even when the final message only says “Document processing failed.”

For `CHUNK_CONTEXT_TOO_LARGE`, details can include:

```json
{
  "unitId": "unit-12",
  "blockId": "block-7",
  "tokenLimit": 256
}
```

Show these details without claiming the offending full unit is available.

## 7. Reconnect and refresh behavior

There is **no Redis progress history**. `getProgressHistory()` returns an empty array. Do not implement a replay request, assume 24-hour history, or rely on `Last-Event-ID` for recovery.

On connection, the backend checks readiness:

- Failed ingestion → `failed`, then closes.
- Completed ingestion → `chunks_ready`.
- Completed summary → `completed`, then closes.
- Failed summary → `summary_failed`, then closes.
- Processing summary → `summarizing`, then continues streaming.

Unexpected stream closure during processing is a connection problem, not proof of ingestion failure. Use bounded reconnect backoff for nonterminal disconnections. Do not reconnect after `completed`, `summary_failed`, or `failed`. Stop retrying authentication failures until authentication is resolved.

After refresh or reconnect:

1. Fetch `/api/documents/my-documents` for statuses.
2. Fetch stored parents for the selected document.
3. Fetch children lazily when parents expand.
4. Restore identity, sections represented by chunks, metadata, links, relationships, and references from saved data.
5. Label original extraction text, heading event history, section-part history, and full event timeline as unavailable when not received.

An empty parent response during processing means “not saved yet,” not “document has zero chunks.” Saved chunks do not reconstruct the full extraction or every heading decision.

Keep live state for the current session. Never merge different documents. If browser persistence is already supported, label it client-captured data, not backend replay.

## 8. Inspector UI

Use the existing design system and provide these views.

### A. Progress overview

Show filename, detected identity, chunker version, ingestion phase, summary state, connection state, known source/page counts, prepared parents/children, embedded children, saved counts, warnings, unresolved relationships, and live-versus-stored provenance.

Use indeterminate progress when denominators are unknown. Do not invent an overall percentage or count every event as a unit of work.

### B. Source viewer

Show received `page_extracted` text, source ID/kind, physical page when known, parser page separately, sequence index, format, text length, parser item count or “Unavailable,” and warnings.

Offer raw text and safe Markdown rendering. Do not execute embedded HTML. Sources without physical page numbers should be labelled “Source …” or “Rendered source …,” not “Page 0.”

### C. Identity and heading decisions

Show identity title, filename, status, title source, accepted candidate IDs, proposal, warnings, and evidence.

For headings show original text, normalized title, kind, original level, numbering, role, status, parent candidate ID, inferred depth, reasons, warnings, and locations.

Build the inferred tree from `parentCandidateId`, tolerating missing events. Keep unresolved candidates visible without invented parents.

### D. Sections and reading order

Show breadcrumbs, status, review flag, available parts, and final parent/child counts. Distinguish original reading placement (`reading_section_ids`) from a continued table’s owning section.

### E. Tables and lists

Group available chunks by document-scoped table/list IDs. For tables show table/row/block IDs, rendered labelled values, header/note/definition locations, continuation evidence, references, fragments, and review flags.

Do not interpret labelled text as a complete structured cell schema: the API does not send a dedicated fields/columns array.

For lists show item IDs and fragments. Count unique item IDs within the selected scope; a fragment is not a new item.

### F. Parent/child cards

For parents show ID, index, breadcrumb, source pages, rendered `text`, contextual `searchText`, budget, structural IDs, warnings, identity, relationships, references, previous/next navigation, children, and expandable raw metadata.

Load children lazily through REST after saving; use received live children before saving.

For children show ID/index, parent ID, text and searchText separately, budget, completed embedding diagnostics, evidence, fragment/compaction flags, vector dimensions when available, and collapsible stored vectors.

Do not label embedding complete from `child_created` or token-budget measurement alone.

### G. Relationship navigation

Provide distinct navigation for previous/next parents, explicit “explains”/“references,” and inferred table continuations. Navigate known `targetParentIds` while preserving unresolved status.

Frontend navigation does not mean the backend search traverses these semantic links; that is pending Part 2.

### H. Timeline and raw payloads

Show every received event’s timestamp, type, phase, relevant IDs, readable description, and expandable full JSON. Filter by extraction, headings, structure, chunking, embedding, saving, summary, warnings, and errors. Preserve unknown event types.

Use virtualization or progressive rendering for large lists. Avoid rendering all 384 vector numbers in every card by default. Keep stream reading responsive.

## 9. State management and merging

Use document-scoped normalized maps for documents, sources, heading decisions, sections, section parts, parents, children, relationships/references, events, readiness, and connection state.

Recommended keys:

```text
source: documentId + source.id
section: documentId + sectionId
section part: documentId + sectionId + partIndex
heading: documentId + decision.id
parent: parent.id
child: child.id
```

Implement event-specific normalization:

- `parent_created.parent.id` and `parent.parentId` map to one parent.
- `child_created.child.id` and `child.childId` map to one child.
- Do not spread numeric `parent`/`child` display ordinals over entity objects.
- Preserve child arrays separately from parent responses.
- Merge richer embedding metadata without overwriting it with older preparation data.
- Do not reset saved/readiness state when preparation events or requests arrive late.
- Cancel or ignore stale requests after switching documents.
- Derive deduplicated relationships without altering source evidence.
- Preserve raw payloads even when normalized entities update.

Final REST data is authoritative for persisted chunk text, metadata, links, counts, and vectors. Fetch parents after `chunks_saved`/`chunks_ready` as appropriate; keep children lazy to avoid downloading every vector unnecessarily.

## 10. Acceptance checks

Add suitable frontend tests or fixtures for:

1. Authenticated SSE parsing across arbitrary network boundaries.
2. Parent/child upserts without double counting.
3. Prepared, embedded, saved, searchable, and summary states staying distinct.
4. Summary failure leaving questions available.
5. Reload restoring chunks while marking unavailable extraction history.
6. Null physical pages and section-part metadata.
7. Older metadata missing v4 fields.
8. Unresolved table matches and references.
9. Table context from different sources.
10. Split rows/items retaining identities.
11. Compaction retaining full identity metadata.
12. Safe Markdown/raw rendering.
13. Switching documents without stale updates.
14. Unknown event types and malformed records.
15. Vectors arriving through REST, not assumed present live.

Use fixtures reproducing these known cases:

- Sections 17 and 18 shown as siblings when decisions support it.
- D08–D12 continued financial rows shown with owning section and original reading placement.
- Section 5A’s explicit explanation separate from previous/next links.
- Kettleby values with distinct meanings: Census, 1 January 2022: `158,744`; Metropolitan area, 31 December 2023: `361,092`; City proper, 31 December 2023: `163,482`.
- A 19-item list shown through unique item IDs and parent grouping where available.

The backend had **66 passing targeted offline tests** on 6 October 2026. The original stress PDF’s fresh live upload and persisted output have not yet been validated. Do not present fixture results as a successful real upload.

Deliver the frontend implementation, explain changed files, report tests, and distinguish fixture verification from real authenticated API verification. If backend access is unavailable, complete the integration and identify specific pending live checks.

## Backend sources used to verify this contract

- [Chunk orchestration and metadata](../src/services/chunking.service.js)
- [Identity and heading/section events](../src/services/document-sections.service.js)
- [Document identity](../src/services/document-identity.service.js)
- [Table continuations and references](../src/services/document-relations.service.js)
- [Token packing](../src/services/token-packer.service.js)
- [Embedding measurements](../src/services/embedding.service.js)
- [Worker events and readiness](../src/workers/document.worker.js)
- [SSE transport and upload responses](../src/controllers/document.controller.js)
- [Live-only progress publication](../src/config/uploadProgress.js)
- [Inspection response construction](../src/services/document.service.js)
- [Stored parent/child queries](../src/repositories/document.repository.js)
- [Authenticated routes](../src/routes/document.routes.js)

This document supersedes stale replay and character-splitting assumptions in earlier frontend handoff notes for the v4 pipeline.
