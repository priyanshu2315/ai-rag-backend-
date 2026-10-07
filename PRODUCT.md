# Ai Rag — Product & Technical Overview

This document explains what this project does, how it is built, and how data
flows through it end to end — written so that someone with no prior context
can understand the whole system after reading it once.

Ingestion and chunking updated **6 October 2026**: Part 1 now uses
`structured-context-v4`. Its 66 targeted offline tests pass. A fresh upload
of the original stress PDF and inspection of persisted chunks remain pending;
Part 2 search improvements have not been implemented.

---

## 1. What this project is

**Ai Rag** is a backend service for **"chat with your documents."** A user
uploads a file (PDF, Word doc, image, or plain text). The system reads it,
breaks it into searchable pieces, and lets the user ask questions about it in
natural language through a chat interface. The AI answers using only the
content of the uploaded document(s) and cites the page it pulled each fact
from — it is deliberately built to avoid making things up (hallucinating).

This pattern — "look things up in your own data, then let an LLM write the
answer" — is called **RAG: Retrieval-Augmented Generation**. Instead of
relying on what a language model memorized during training, RAG retrieves
relevant text from a private knowledge base first, and feeds that text to the
model as context before it answers.

On top of plain RAG, this project uses **Corrective RAG (CRAG)**: every set
of search results is graded before it is used, and if nothing useful was
found, the search is rewritten and tried again.

There is no frontend in this repository — it is a **Node.js/Express REST +
streaming API** meant to be driven by a separate client application.

---

## 2. The core idea in plain language

1. **Ingestion (offline, happens once per document):**
   A document is uploaded, its text and structure are extracted, relationships
   are checked, and labelled parent/child pieces ("chunks") are built within
   token budgets. Each child is converted into a list of numbers (an
   "embedding") that captures its meaning. Those numbers are stored in a
   database that can search by _meaning_ instead of just keywords. The user
   can watch this happen live, page by page.

2. **Retrieval (happens per question):**
   The question is checked for attacks, sorted by type (greeting, summary,
   specific page, or factual question), and — for factual questions — split
   into smaller searches. Each search looks for the stored chunks closest in
   meaning (and in keywords) to it.

3. **Checking (happens per question):**
   A grader looks at all the retrieved chunks together and keeps the ones
   that help answer any part of the question. If none help, the search is
   rewritten and run again (up to 3 attempts).

4. **Generation (happens per question):**
   The kept chunks are handed to an LLM along with the question, and the LLM
   is instructed to answer _using only that text_, to cite where each fact
   came from, and to say clearly which parts it could not find.

Everything in this codebase exists to implement those steps reliably, plus
user accounts, conversation history, security checks and evaluation around
them.

---

## 3. High-level architecture

```
                 ┌─────────────┐
                 │   Client    │  (not in this repo)
                 └──────┬──────┘
                        │ REST / SSE (JWT auth)
                        ▼
          ┌─────────────────────────────┐
          │        Express API           │
          │  /api/auth  /api/documents   │
          │        /api/chat             │
          └───────┬───────────┬─────────┘
                  │           │
    upload file   │           │  ask question
                  ▼           ▼
       ┌────────────────┐   ┌──────────────────────────────┐
       │ Supabase        │   │ Security firewall             │
       │ Storage         │   │  checkMaliciousIntent()       │
       │ (raw files)     │   └──────────────┬───────────────┘
       └───────┬─────────┘                  ▼
               │ queues a job   ┌──────────────────────────────┐
               ▼                │ CRAG graph (LangGraph)        │
       ┌────────────────┐       │ route → split → search →      │
       │ Redis (BullMQ)  │       │ grade → (rewrite) → answer    │
       │ job queue       │       └──────────────┬───────────────┘
       └───────┬─────────┘                      │ vector + keyword search
               │ picked up by                   ▼
               ▼                       ┌───────────────────┐
       ┌────────────────────────┐      │ PostgreSQL +       │
       │ Background Worker        │─────▶│ pgvector           │
       │ parse → chunk → embed → │      │ (Users, Documents, │
       │ save → summarize        │      │ Chunks, Chats)     │
       └───────────┬────────────┘      └────────────────────┘
                   │ progress events (Redis Pub/Sub)
                   ▼
          GET /api/documents/progress/:docId  (SSE to the client)
```

A drawn version of the architecture, with the function behind every part,
is in [docs/architecture.png](docs/architecture.png) and
[docs/architecture.html](docs/architecture.html).

External AI services used along the way: **LlamaParse** (document OCR/parsing),
a local **Xenova/transformers** model (embeddings), **Groq or OpenRouter**
(the LLMs), **Cohere** (reranking search results), and **LangSmith**
(tracing/observability of the AI calls).

---

## 4. Technology stack

| Layer                  | Technology                                                                                     | Why it's here                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP server            | Express 5                                                                                      | REST API + Server-Sent Events streaming                                                                                                                             |
| Database ORM           | Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`)                                              | Type-safe DB access, migrations                                                                                                                                     |
| Database               | PostgreSQL + `pgvector` extension                                                              | Stores relational data **and** embedding vectors in one place                                                                                                       |
| Local dev infra        | Docker Compose (`pgvector/pgvector:pg16`, `redis`, `pgadmin`)                                  | Spin up Postgres+pgvector and Redis without installing them locally                                                                                                 |
| Hosted infra option    | Supabase (Postgres + Storage)                                                                  | `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` used for file storage; the same Postgres can host the app DB                                                                  |
| File storage           | Supabase Storage (`documents` bucket)                                                          | Uploaded files are stored here, not on local disk (`multer` uses memory storage only)                                                                               |
| Background jobs        | BullMQ + Redis                                                                                 | Document processing (parsing/embedding/summarizing) happens off the request thread                                                                                  |
| Live progress          | Redis Pub/Sub + SSE                                                                            | The worker publishes chunking progress; an SSE endpoint streams it to the client                                                                                    |
| Document parsing       | `llama-cloud-services` (LlamaParse), `pdf-parse`, `mammoth`, `cheerio`, `turndown`             | Converts PDFs/DOCX/images into clean Markdown text, including OCR for scanned pages/tables/charts                                                                   |
| Structure and chunking | `unified`, `remark-parse`, `remark-gfm`, application structure services                        | Collects Markdown blocks and relationships, then packs labelled chunks using the embedding tokenizer; legacy eval seed scripts still use `@langchain/textsplitters` |
| Embeddings             | `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384 dimensions)                             | Runs **locally**, no per-call API cost, converts text → vector                                                                                                      |
| Orchestration          | `@langchain/langgraph`                                                                         | Runs the question-answering pipeline as a state machine (the CRAG graph)                                                                                            |
| Reranking              | Cohere (`rerank-english-v3.0`)                                                                 | A more accurate (but slower) second pass that re-scores the initial search results                                                                                  |
| LLMs                   | Groq or OpenRouter, via the OpenAI SDK (`openai` npm package pointed at a different `baseURL`) | `gpt-oss-120b` for planning and answers; `gpt-oss-20b` for fast checks and summaries (see §8.4)                                                                     |
| Token counting         | `gpt-tokenizer`                                                                                | Keeps summarization batches under the per-call limit                                                                                                                |
| Auth                   | `jsonwebtoken` + `bcryptjs`                                                                    | Stateless JWT sessions, hashed passwords                                                                                                                            |
| Observability          | LangSmith (`langsmith/traceable`)                                                              | Traces the pipeline's steps and LLM calls for debugging                                                                                                             |

---

## 5. Data model (Prisma schema)

```
User
 ├─ id, email, password (bcrypt hash)
 ├─ resetOtp, resetOtpExpiresAt        (forgot-password flow)
 ├─ Documents[]                        (files this user uploaded)
 └─ Conversations[]                    (chat threads this user has)

Document
 ├─ id, filename, fileUrl, status      ("PROCESSING" | "COMPLETED" | "FAILED")
 ├─ summary                            (AI-generated master summary, filled in by the worker)
 ├─ summaryStatus                      ("PENDING" | "PROCESSING" | "COMPLETED" | "FAILED")
 ├─ userId → User
 ├─ ParentChunks[]
 └─ Conversations[]                    (chat threads scoped to this one document)

ParentChunk                            ("big" chunk — the unit that gets shown/cited)
 ├─ id, text, searchText, metadata      (source evidence, identity, structure, token counts)
 ├─ prevParentId, nextParentId          (nullable same-section reading-order links)
 ├─ documentId → Document
 └─ ChildChunks[]

ChildChunk                             ("small" chunk — the unit that gets embedded/searched)
 ├─ id, text, searchText, metadata      (source evidence, labels, embedding diagnostics)
 ├─ embedding  vector(384)             (pgvector column, raw SQL only — Prisma can't type this natively)
 ├─ parentId → ParentChunk
 └─ documentId (denormalized, for fast per-document filtering)

Conversation
 ├─ id, title, userId → User, documentId → Document (nullable = "search across all my documents")
 └─ Messages[]

Message
 ├─ id, role ("user" | "assistant"), content, conversationId → Conversation
```

### Why "parent" and "child" chunks?

This is a **Parent-Document Retrieval** pattern, and it solves a real
tension in RAG:

- **Small chunks embed better.** A short, focused piece of text produces a
  more precise vector, so _searching_ with small chunks finds more accurate
  matches.
- **Small chunks need context.** A short snippet can lack the
  surrounding context an LLM needs to answer correctly.

The chunker first builds structural units: prose, labelled table rows, list
items, code and explanation text. It packs these into **parents** with a
default budget of 1,024 tokens and **children** limited to the lower of 256
tokens and the embedding tokenizer's limit. Counts include document/section
prefixes, repeated labels and tokenizer special tokens. Parents are not embedded.

`text` contains the rendered passage, including structural labels where
needed; `searchText` also carries document identity and the section breadcrumb.
Child `searchText` is embedded and searched; retrieval returns the parent's
contextual `searchText` for reranking, grading and answers. There is no
character overlap. Previous/next links connect parents within the same section.

---

## 6. Flow #1 — Authentication

Files: [auth.routes.js](src/routes/auth.routes.js) → [auth.controller.js](src/controllers/auth.controller.js) → [auth.service.js](src/services/auth.service.js) → [auth.repository.js](src/repositories/auth.repository.js)

| Endpoint                    | Method | What happens                                                                        |
| --------------------------- | ------ | ----------------------------------------------------------------------------------- |
| `/api/auth/register`        | POST   | Hashes password with bcrypt, creates a `User` row                                   |
| `/api/auth/login`           | POST   | Verifies password, issues a **JWT** (`jsonwebtoken`) valid for 7 days               |
| `/api/auth/forgot-password` | POST   | Generates a random 6-digit OTP, stores it with a 10-minute expiry on the `User` row |
| `/api/auth/reset-password`  | POST   | Verifies the OTP + expiry, hashes and saves the new password, clears the OTP        |

Every other route requires the JWT: the client sends
`Authorization: Bearer <token>`, and [auth.middleware.js](src/middlewares/auth.middleware.js)
verifies it and attaches `req.user = { id: userId }` for downstream handlers.

> Note: `forgot-password` currently returns the OTP directly in the API
> response instead of emailing/texting it — there is no email/SMS delivery
> wired up yet, so this is effectively a stand-in for that integration.

---

## 7. Flow #2 — Document ingestion (upload → searchable)

Files: [document.routes.js](src/routes/document.routes.js) → [document.controller.js](src/controllers/document.controller.js) → [document.service.js](src/services/document.service.js) → [document.worker.js](src/workers/document.worker.js) → [ai.service.js](src/services/ai.service.js), [uploadProgress.js](src/config/uploadProgress.js)

**Step-by-step:**

1. **Upload** — `POST /api/documents/upload` (auth required, `multipart/form-data`,
   field name `file`). `multer` holds the file in memory (no temp disk file).
2. **Store the raw file** — the controller uploads the buffer straight to
   **Supabase Storage** (`documents` bucket) under `<userId>/<timestamp>-<filename>`,
   and gets back a public URL.
3. **Create the DB record** — a `Document` row is created with
   `status = "PROCESSING"`.
4. **Queue the job** — a BullMQ job (`extract-and-embed`) is pushed onto the
   `document-processing` Redis queue with `{ documentId, filepath, mimetype }`.
   The HTTP request returns immediately (`202 Accepted`) — the client doesn't
   wait for processing to finish.
5. **Background worker picks up the job** (runs in-process, started by
   `startWorker()` in [server.js](server.js)):
   - **Extract and normalize**: `extractDocument({ filepath, filename, mimetype })`
     downloads the file. Supported PDFs, DOCX and images go through LlamaParse
     premium parsing with layout requested and cross-page Markdown table merging
     disabled. UTF-8 text/Markdown is decoded locally. The result follows
     `extraction-v1`, preserving source order, original text, parser page numbers,
     physical PDF page numbers where known, and warnings. Parser instructions
     request headings, tables and OCR; they do not guarantee correct structure.
   - **Check structure and build chunks**: `buildDocumentChunks()` runs the
     identity/heading pass, collects blocks, resolves supported relationships,
     builds structural units and packs parents/children (§7.2).
   - **Embed**: the shared local `Xenova/all-MiniLM-L6-v2` service embeds each
     child's complete `searchText` into a normalized 384-dimensional vector.
     The worker independently checks the tokenizer budget with
     `rejectTruncation: true` and records embedding diagnostics in metadata.
   - **Save and expose for search**: `saveDocumentChunks()` saves all parents,
     children, metadata and links in a transaction. The worker then sets
     `status="COMPLETED"`, `summaryStatus="PROCESSING"` and emits `chunks_ready`.
   - **Summarize**: the worker batches the extracted text at approximately
     5,000 tokens, calls the configured `summary` task and combines batch
     summaries when needed. It saves `Document.summary` and sets
     `summaryStatus="COMPLETED"`. Summary failure sets only
     `summaryStatus="FAILED"`; saved chunks remain searchable.

While a document is `"PROCESSING"` or `"FAILED"`, the chat endpoint refuses
to answer questions about it (see next section).
Extraction, chunking, embedding or saving failures set ingestion to `FAILED`.
Summary requests separately check summary readiness and saved summary content.

### 7.1 Live progress while a document processes

So the user sees progress instead of a blank screen, the worker publishes an
event to the Redis Pub/Sub channel `doc-progress:<documentId>` at every step
(`publishProgress()` in [uploadProgress.js](src/config/uploadProgress.js)).

`GET /api/documents/progress/:docId` (auth required, owner only) is an SSE
endpoint (`streamProgress()`) that subscribes to that channel and forwards
each event to the client:

| Event `type`                                      | Fields                                                                      | Meaning                                                                      |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `extraction_complete`, `page_extracted`           | Source counts, warnings; page text and source mapping                       | Extraction available for live inspection                                     |
| `structure_resolved`                              | `totalBlocks`, `totalUnits`, `tableContinuations`, `references`, `warnings` | Structure decisions available; nothing saved yet                             |
| `parent_created`, `child_created`, `parent_links` | Contextual text, metadata and links                                         | Chunks prepared in memory                                                    |
| `page_start`, `parent`, `child`                   | Primary source, parent/child IDs and metadata                               | Worker progress; `child` includes embedding diagnostics, still before saving |
| `chunking_failed`, `embedding_failed`             | Error details and unit/chunk identifiers where available                    | Preparation failure diagnostics                                              |
| `saving_chunks`, `chunks_saved`                   | Parent/child totals                                                         | Persistence starts, then completes                                           |
| `chunks_ready`                                    | –                                                                           | Ingestion completed; document questions can run                              |
| `summarizing`                                     | –                                                                           | Generating the summary                                                       |
| `completed`, `summary_failed`                     | Error message where applicable                                              | Summary finished or failed; stream closes                                    |
| `failed`                                          | `message`                                                                   | Processing failed; the stream closes                                         |

On reconnect, the endpoint reports current readiness: ingestion failure,
or `chunks_ready` followed by the current summary state. Events carry document
IDs, UUID event IDs and timestamps. The stream is live only:
`getProgressHistory()` returns `[]`; extracted pages and old events are not replayed.
Rebuild saved chunk views through the authenticated, owner-checked parent/child
inspection endpoints. Missing live extraction data is unknown, not a measured zero.

### 7.2 Part 1: structure-aware chunking

The active version is **`structured-context-v4`**. Its structure decisions use
ordinary parsing rules; no generative AI call is added during chunk creation.
LlamaParse extraction and local embedding inference remain separate steps.

1. **Document identity and headings.** Collect heading candidates throughout
   the extraction, keeping list items and fenced code separate. Infer identity
   from a filename-corroborated opening title or an isolated cover followed by
   numbered Markdown content; otherwise use the filename. Identity remains
   separate from the changing section breadcrumb. Numbering evidence can make
   sections 17 and 18 siblings despite conflicting Markdown levels. Ambiguous
   bold headings, restarts and unsupported numbering retain review diagnostics.
2. **Blocks and source evidence.** Collect Markdown tables, nested lists,
   prose, code and raw unsupported content with source offsets. Sections and
   structural IDs are document-local metadata, not new database models.
3. **Table continuations.** Infer a continuation only with an adjacent source,
   compatible columns/value types and consecutive prefixed row IDs such as
   D07 → D08. Repeated full tables also require matching headers. Multiple
   candidates remain unresolved; similar columns alone cannot join tables.
   A supported continuation keeps its table/section identity even when an
   unrelated heading intervenes in reading order.
4. **Explicit references.** Resolve supported `section N` references only
   against unique local section labels. An explanation must target one table;
   matching column-key definitions are incorporated into row labels, and
   explanatory text is also indexed for that table. Conflicting definitions
   and multiple explanation targets are flagged. A section named `5A` does
   not automatically explain `5`. Reference metadata includes target parent IDs;
   it is separate from previous/next links.
5. **Labelled units and token packing.** Repeat table headers and their dates,
   supported column definitions, and adjacent units/notes with row values.
   Keep complete rows and list items when they fit; a 19-item list can share
   one parent when its budget permits. Oversized rows split into labelled
   fields with row identity repeated. Larger values/prose prefer newline,
   sentence and word boundaries, with Unicode code-point splitting as fallback.
   Every complete rendered piece is re-tokenized. Long identity/breadcrumb
   prefixes can fall back to stable IDs while full metadata remains available.
   Mandatory context that still cannot fit raises `CHUNK_CONTEXT_TOO_LARGE`
   instead of silently truncating values.

Parents and children retain `document_identity`, `heading_path`, `section_id`,
`section_structure`, block/table/row/list IDs, `token_budget`, warnings,
relationships and references. `source_locations` records passage evidence;
`context_locations` separately records headers, definitions and notes.
`source_pages` includes known physical pages contributing either kind of evidence.
The primary `source` remains available for worker compatibility. Non-PDF rendered
source numbers are not presented as physical PDF pages.

`section_part_index` and `section_part_span` are now null because packed chunks
can combine parts. Inspectors should use `source_locations`; its `source_unit`
scope can cover a larger span than an individual split child. Flags such as
`contains_unit_fragments`, `context_compacted` and `structure_warnings` expose
fallbacks. `reading_section_ids` preserves original placement when table
ownership differs from reading order.

**Implementation status:** Part 1 code is integrated and its targeted offline
suite passes (§10). No database migration or reset is required. Restart the
backend/worker and upload a fresh document to exercise this version; existing
uploads retain their old chunks. Acceptance still requires inspecting saved
parents and children from the original stress PDF, which was unavailable locally.

**Part 2 remains pending:** search currently expands immediate same-section
neighbors. It does not traverse the new explicit reference metadata or prove
coverage of every requested fact. Attaching supported column meanings during
ingestion helps existing retrieval, but does not complete those search changes.

---

## 8. Flow #3 — Asking a question (Corrective RAG)

Files: [chat.routes.js](src/routes/chat.routes.js) → [chat.controller.js](src/controllers/chat.controller.js) → [chat.service.js](src/services/chat.service.js) → [crag.service.js](src/services/crag.service.js) + [chat.repository.js](src/repositories/chat.repository.js) + [ai.service.js](src/services/ai.service.js)

**Endpoint:** `POST /api/chat` (auth required)
**Body:** `{ question, documentId?, conversationId }`
`documentId` omitted = search across _all_ of the user's documents instead
of one.

### 8.1 Before the pipeline

1. **Controller checks** (`askQuestion()`): the question must be present. If
   a `documentId` is given and the document is `PROCESSING`, the API returns
   plain JSON `202` ("still processing"); if `FAILED`, JSON `500`. Otherwise
   it opens an **SSE** stream.
2. **Security firewall** (`checkMaliciousIntent()`, `gpt-oss-20b`): screens
   the question for prompt-injection attempts — overriding instructions,
   revealing the system prompt, switching persona, or forcing an exact
   output string. Questions about sensitive topics in the user's own
   documents (salaries, staff, finances) are allowed. A malicious question
   gets a fixed refusal, both are saved to history, and the stream ends. If
   the classifier itself errors, the question is treated as safe and the
   answer step's own security rules act as the backstop.
3. **History**: the question is saved as a `Message`, and the last 6
   messages of the conversation are loaded as context.
4. **Run the graph**: `cragPipeline.invoke()` is called with the question,
   document, user and history. The SSE callback is passed through LangGraph's
   `config.configurable.onEvent`, so every step of the graph can stream its
   progress to the client.

### 8.2 The CRAG graph

```
START → analyze_intent ─┬─ greeting ───────────────────────────┐
                        ├─ summary → fetch_summary ─────────────┤
                        ├─ page    → fetch_page ────────────────┤
                        └─ search  → decompose → retrieve → grade
                                                   ▲          │
                                                   │   none kept, < 3 tries
                                                rewrite ◀──────┤
                                                              │ some kept, or 3 tries
                                                              ▼
                                                           generate → END
```

| Node             | Model | What it does                                                                                   |
| ---------------- | ----- | ---------------------------------------------------------------------------------------------- |
| `analyze_intent` | 20b   | Sorts the question: `greeting`, `summary`, `page` (with a page number) or `search`             |
| `fetch_summary`  | –     | Loads the pre-computed `Document.summary`                                                      |
| `fetch_page`     | –     | Loads every parent chunk on the requested page (`getChunksByPage()`)                           |
| `decompose`      | 120b  | Splits the question into up to 4 separate searches, one fact per search                        |
| `retrieve`       | –     | Runs each search: embed → hybrid search → Cohere rerank (top 3) → merge and remove duplicates  |
| `grade`          | 20b   | Looks at **all** retrieved chunks in one call and keeps those that help any part of the answer |
| `rewrite`        | 20b   | If nothing was kept, writes a new search query (the user's question itself stays unchanged)    |
| `generate`       | 120b  | Writes the final answer from the kept chunks, with citations                                   |

**Hybrid search** (`searchSingleDocument()` / `searchAllUserDocuments()`):

- the search text is embedded and matched against `ChildChunk.embedding`
  with pgvector's cosine-distance operator (`<=>`), top 20;
- in parallel, Postgres full-text search (`ts_rank_cd` / `plainto_tsquery`)
  finds the top 20 keyword matches;
- the two lists are merged with **Reciprocal Rank Fusion (RRF)** — each
  result scores `1 / (k + rank)`, summed across both lists (`k = 10` for a
  single document, `k = 60` across all of a user's documents);
- results are grouped up from child chunks to their **parent** chunks,
  up to 15 per search;
- **Cohere's reranker** re-scores parent `searchText` and keeps the best 3;
- after deduplication, immediate same-section parent neighbors are added,
  capped at 24 total parents. This is reading-order expansion; explicit
  reference traversal remains Part 2 work.

**Why the grader sees all chunks together:** an answer is often split across
pages. For example, one page says 400 kWh falls in Slab 3, and a later page
gives Slab 3's new rate. Judged alone, the second page never mentions 400 kWh
and looks useless. Judged together, it is clearly needed. The grader
therefore keeps chunks that are only useful in combination, chunks with
values needed for a calculation, and any correction or erratum. If the
grader errors, all chunks are kept.

**Loop limit:** retrieval runs at most 3 times. After the third attempt the
graph generates an answer with whatever it has (usually "cannot find").

### 8.3 How the answer is written

`generateNode()` wraps the question and every retrieved chunk in XML tags
with a random name per request (`<doc_1a2b3c4d source_id="Page 5">`), and
tells the model to treat anything inside those tags as data, never as
instructions. This blocks instructions hidden in uploaded documents. The
grounding rules tell the model to:

- use only the retrieved text, never its own knowledge;
- do arithmetic from numbers in the text, and show it;
- answer the parts it can and say clearly which part is missing;
- say "the retrieved sections do not show", never "the document does not
  contain", because it only sees part of the document;
- when values differ by date or version, use the one in effect at the date
  asked about, and mention the other;
- never work out a fact from indirect clues (to say which item is highest or
  lowest, it must see the actual values);
- cite every fact as `[Source ID: Page N]`.

Greetings skip retrieval and get a short, friendly reply instead.

Finally, the answer is streamed to the client **word by word** (a 20ms delay
between words, purely for a smooth "typing" UI effect — the answer is already
fully generated at this point), saved as an `assistant` `Message`, and a
`done` event closes the stream.

### 8.4 Which model does what

| Model          | Config name      | Used for                                                                                  |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `gpt-oss-120b` | `MODELS.agent`   | Question splitting (`decompose`), final answers (`generate`), eval generation and judging |
| `gpt-oss-20b`  | `MODELS.fast`    | Security firewall, intent routing, relevance grading, query rewriting                     |
| `gpt-oss-20b`  | `MODELS.summary` | Document summaries in the worker                                                          |

### 8.5 SSE events

| `type`        | Fields            | Sent when                                                                                                                            |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `status`      | `message`         | A stage changes, and once per graded chunk ("Chunk 2/6 (Page 3): relevant")                                                          |
| `tool_start`  | `tool`, `query`   | A step starts: Intent Classifier, Question Splitter, Hybrid Search, Relevance Grader, Query Rewriter, Summary Lookup, Page Retrieval |
| `tool_finish` | `tool`, `message` | That step finishes, with its result                                                                                                  |
| `token`       | `text`            | One word of the final answer                                                                                                         |
| `done`        | –                 | Answer complete                                                                                                                      |
| `error`       | `message`         | Something failed mid-stream                                                                                                          |

### 8.6 Conversation sessions

- `GET /api/chat/conversation?documentId=...` fetches-or-creates the single
  ongoing `Conversation` for this user (+ this document, if given),
  including its full message history. A client calls this on page load to
  restore a chat thread.
- `DELETE /api/chat/conversation?documentId=...` deletes that conversation's
  messages but keeps the conversation itself, so the client's
  `conversationId` stays valid. Returns `{ success, message, data: { documentId, deletedMessages } }`.
  Useful before a test run, so earlier answers don't leak in through history.

---

## 9. Security

- **Document inspection authentication**: parent/child inspection and progress
  routes require a JWT and check document ownership.
- **Prompt-injection firewall**: `checkMaliciousIntent()` screens every
  question before retrieval (§8.1).
- **Untrusted-text wrappers**: retrieved text and questions are wrapped in
  randomly named tags, so instructions hidden inside a document are treated
  as data (§8.3).
- **Red-team testing**: the pipeline has been tested with documents
  containing hidden instructions, fake system tags, fake chat turns, forged
  citations and policy-shaped phishing instructions. Direct commands are
  resisted; false _facts_ written into a document are still repeated as
  true, because the model cannot tell a real document from a lying one.

---

## 10. Evaluation

Scripts in [src/scripts](src/scripts), datasets in [src/evals](src/evals),
test documents in [eval-docs](eval-docs).

| Command                                    | Document                                                                                                 | Questions                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `npm run seedEvals` / `npm run runEvals`   | Drug and alcohol policy (`Sample-Policy-for-Drug-and-Alcohol-use.pdf`)                                   | 10, in `goldenDataSet.js`                       |
| `npm run seedEvals2` / `npm run runEvals2` | Travel and expense policy (`Northwind-Travel-Expense-Policy.pdf`)                                        | 25, in `goldenDataSet2.js`, scored per category |
| (dataset only)                             | Annual report with image-only charts, errata and addenda (`Kestrel-Annual-Operations-Report-FY2025.pdf`) | 36, in `goldenDataSet3.js`                      |

- **Legacy seed scripts** have their own character splitters (1,200-character
  parents and 400-character children) and fixed parent IDs for golden questions.
  They do not exercise the worker's `structured-context-v4` chunker and must
  not be treated as validation of Part 1.
- **Run scripts** measure retrieval (MRR and Recall@3 against those chunk
  ids; multi-chunk targets must all be retrieved) and use `gpt-oss-120b` as
  an LLM judge for **faithfulness** (is the answer grounded in the context?)
  and **relevance** (does it match the expected answer?).
- `goldenDataSet3.js` has no seed/run scripts yet, and its target chunk ids
  are still placeholders.
- The run scripts use a simple answer prompt, not the full CRAG graph, so
  they measure retrieval plus one LLM call rather than exactly what users
  get.

### Part 1 chunking validation

On **6 October 2026**, all **66 targeted tests passed** in the project,
including the real cached MiniLM tokenizer and a generated child's normalized
384-dimensional embedding. Fixtures cover heading siblings, document identity,
interrupted tables, explicit column definitions, Kettleby population dates,
19-item lists, oversized rows, Unicode preservation, ambiguous matches and
budget-failure diagnostics.

Run the suite from the project root in PowerShell:

```powershell
$chunkingTests = @(
  'tests/extraction-normalizer.test.js',
  'tests/chunk-source-metadata.test.js',
  'tests/document-blocks.test.js',
  'tests/document-identity.test.js',
  'tests/heading-structure.test.js',
  'tests/embedding.service.test.js',
  'tests/structured-chunking.test.js'
)
node --import ./tests/offline-embedding-setup.js --test @chunkingTests
```

The offline setup disables model downloads and uses the existing Transformers.js
model cache. These tests do not start the worker or contact LlamaParse, Redis,
Supabase or PostgreSQL. `npm test` is still a placeholder. A fresh upload of
`Chunking_Stress_Test_Document.pdf` and inspection through the parent/child
REST endpoints remain necessary to validate extraction and persisted output.

---

## 11. Full API reference

| Method | Path                                           | Auth | Purpose                                                                                    |
| ------ | ---------------------------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| POST   | `/api/auth/register`                           | –    | Create account                                                                             |
| POST   | `/api/auth/login`                              | –    | Get JWT                                                                                    |
| POST   | `/api/auth/forgot-password`                    | –    | Issue OTP                                                                                  |
| POST   | `/api/auth/reset-password`                     | –    | Consume OTP, set new password                                                              |
| POST   | `/api/documents/upload`                        | ✅   | Upload a file, kicks off ingestion                                                         |
| GET    | `/api/documents/progress/:docId`               | ✅   | Live processing progress (SSE)                                                             |
| GET    | `/api/documents/`                              | ✅   | List **all** documents in the system                                                       |
| GET    | `/api/documents/my-documents`                  | ✅   | List the current user's documents                                                          |
| DELETE | `/api/documents/:docId`                        | ✅   | Delete a document you own (see [docs/delete-document-api.md](docs/delete-document-api.md)) |
| GET    | `/api/documents/get-all-parent-chunk/:docId`   | ✅   | Owner only: parent text, searchText, metadata, links and child counts                      |
| GET    | `/api/documents/get-all-child-chunk/:parentId` | ✅   | Owner only: parent plus children, contextual text, metadata, vectors and dimensions        |
| POST   | `/api/chat`                                    | ✅   | Ask a question (SSE streaming response)                                                    |
| GET    | `/api/chat/conversation`                       | ✅   | Get/create the chat thread + history                                                       |
| DELETE | `/api/chat/conversation`                       | ✅   | Clear the chat thread's messages                                                           |

---

## 12. Known limitations

- **Access control**: `GET /api/documents/` returns every user's documents;
  `POST /api/chat` does not check that the `documentId` belongs to the
  caller. Chunk-inspection routes do check authentication and ownership.
- **Rate limits on large uploads**: summary batches can exceed Groq's free
  per-minute token limit when that provider is configured. Summary failure
  sets `summaryStatus=FAILED` while searchable chunks stay available. There
  is no automatic summary retry on `429` responses.
- **Extraction and structure**: supported formats still depend on extraction
  quality. Merged-cell HTML tables stay raw; unsupported continuations and
  reference syntax may remain unresolved. Reference matching currently uses
  supported English `section N` forms. Cross-source list grouping is not
  guaranteed. This is not a guarantee of correct chunking for every file.
- **Mandatory context**: a column label, note or row identity that cannot fit
  the embedding limit still causes an explicit ingestion failure. Full source
  offsets remain available, but split-child evidence spans are not exact
  character-level reconstructions of each rendered child.
- **Reference retrieval and coverage**: explicit relationship metadata is
  stored and supported definitions are consumed during ingestion, but search
  does not yet follow those links. A relevance pass does not prove that all
  requested facts or all list items were retrieved.
- **Linked searches**: `decompose` writes later searches as general lookups
  ("managers of each plant") rather than filling in earlier answers, so a
  fact that is not in a table can still be missed.
- **Input size**: questions have no length limit, and history is limited by
  message count (6), not by tokens. The current question is also included in
  the history it is sent with.
- **Intent routing**: short, specific questions are occasionally routed to
  `summary`, which answers from the short summary only.
- **Keyword search** uses `plainto_tsquery`, which requires every word to
  match, so it rarely contributes for longer questions.
- **Cost**: each multi-part question makes up to 4 Cohere rerank calls
  (trial keys allow 10 per minute and 1,000 per month), and splitting on the
  120b model uses its daily token budget faster.
- **Unanswerable questions** go through all 3 retrieval attempts before the
  answer says "not found".
- **Conversations**: the API always reuses the latest conversation for a
  user + document; there is no "new conversation" endpoint, only clearing.

---

## 13. Glossary — technical terms used in this project

- **RAG (Retrieval-Augmented Generation)** — answering questions by first
  retrieving relevant text from a knowledge base, then having an LLM
  generate an answer grounded in that text, instead of relying purely on
  what the model memorized during training.
- **Corrective RAG (CRAG)** — RAG with a checking step: retrieved text is
  graded before use, and a failed search is rewritten and retried.
- **LangGraph / state machine** — a library for running an LLM pipeline as a
  graph of steps ("nodes") that share one state object; "conditional edges"
  decide which node runs next. Implemented in
  [crag.service.js](src/services/crag.service.js).
- **Semantic routing** — using a small, fast LLM to classify a question
  (greeting, summary, page, search) and send it down the cheapest path that
  can answer it.
- **Query decomposition** — splitting a multi-part question into smaller
  searches, each looking for one fact.
- **LLM-as-a-judge / grader** — using an LLM to score something another step
  produced: here, which chunks are relevant (the grader) and how good an
  answer is (the eval judge).
- **Embedding** — a list of numbers (here, 384 of them) that represents the
  _meaning_ of a piece of text, produced by a machine learning model. Texts
  with similar meaning produce numerically similar embeddings, even if they
  don't share any of the same words.
- **Vector / vector search** — an embedding is a "vector" in mathematical
  terms. Vector search means finding the stored vectors that are
  numerically closest to a query vector, which in practice means finding
  the stored text that means the same thing as the question.
- **Cosine distance/similarity** — the specific way "closeness" between two
  vectors is measured here. `pgvector`'s `<=>` operator computes this
  directly inside a SQL query.
- **pgvector** — a PostgreSQL extension that adds a `vector` column type and
  the operators/indexes needed to store embeddings and search them
  efficiently, right alongside normal relational data.
- **Chunking** — grouping document content into smaller searchable pieces.
  This project preserves supported structural labels and packs **parent/child**
  chunks within token budgets, without character overlap. See §5 and §7.2.
- **Hybrid search** — combining vector (semantic/meaning-based) search with
  traditional keyword/full-text search, so the system catches both "things
  that mean the same thing" and "things that literally contain this exact
  word/number/code."
- **Reciprocal Rank Fusion (RRF)** — a simple, effective way to merge two
  differently-scored ranked lists into one: each item's score becomes
  `1 / (k + its rank position)`, and scores are summed across lists. No
  need to normalize or compare the two scoring systems directly.
- **Reranking / cross-encoder** — a second, more expensive search pass that
  looks at the _query and each candidate together_ (rather than comparing
  precomputed vectors) to produce a more accurate relevance ranking. Used
  here (via Cohere) to narrow up to 15 broad candidates down to the best 3.
- **Prompt injection** — text that tries to make an LLM ignore its
  instructions, either typed by the user (direct) or hidden inside a
  retrieved document (indirect).
- **SSE (Server-Sent Events)** — a simple one-way streaming protocol over
  plain HTTP, used here to push live progress (`status`, `tool_start`,
  `token`, ...) to the client while work is still happening, instead of
  making it wait for one big JSON response.
- **Redis Pub/Sub** — a Redis feature where one process publishes messages
  on a named channel and any subscriber receives them; used to carry upload
  progress from the worker to the SSE endpoint.
- **JWT (JSON Web Token)** — a signed, tamper-proof token issued at login
  that encodes the user's identity; sent on every subsequent request in the
  `Authorization` header instead of a server-side session.
- **BullMQ / Redis queue / worker** — BullMQ is a job queue library backed
  by Redis. The upload request just _enqueues_ a job and returns instantly;
  a separate long-running `Worker` (started alongside the API server here)
  pulls jobs off the queue and does the slow work
  (parsing/embedding/summarizing) asynchronously.
- **Rate limits (TPM / TPD)** — the LLM provider's caps on tokens per minute
  and per day. On Groq's free plan each model gets 8,000 tokens per minute
  and 200,000 per day, and the per-minute cap is the one large uploads and
  eval runs hit first.
- **LangSmith / `traceable`** — an observability tool for LLM applications.
  Wrapping a function in `traceable(...)` records its inputs/outputs/timing
  to LangSmith so the pipeline's steps can be inspected after the fact for
  debugging.
- **OTP (One-Time Password)** — the 6-digit, time-limited code used in the
  forgot-password flow to prove the requester controls the account's email,
  before allowing a password reset.

---

## 14. Environment variables

| Variable                               | Used for                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | Prisma's connection to the PostgreSQL database                                  |
| `REDIS_URL`                            | BullMQ job queue and upload-progress Pub/Sub                                    |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Supabase client — file storage (`documents` bucket)                             |
| `JWT_SECRET`                           | Signing/verifying login tokens                                                  |
| `AI_PROVIDER`                          | `"groq"` (default) or `"openrouter"` — selects which LLM provider config to use |
| `GROK_API_KEY`                         | API key for Groq (when `AI_PROVIDER=groq`)                                      |
| `OPENROUTER`                           | API key for OpenRouter (when `AI_PROVIDER=openrouter`)                          |
| `COHERE_API_KEY`                       | Reranking search results                                                        |
| `LLAMA_CLOUD_API_KEY`                  | LlamaParse document parsing/OCR                                                 |
| `PORT`                                 | Express server port (defaults to `3000`)                                        |

Local infra (Postgres+pgvector, Redis, pgAdmin) can be started with
`docker-compose up` — see [docker-compose.yml](docker-compose.yml). Schema
changes go through Prisma Migrate — see [PRISMA_WORKFLOW.md](PRISMA_WORKFLOW.md)
for the exact commands and rules used in this project.

---

## 15. Where to look for each concern

| Concern                                           | File(s)                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HTTP entrypoint, wiring                           | [server.js](server.js)                                                                                                                                                                                                                                                                                       |
| DB schema                                         | [prisma/schema.prisma](prisma/schema.prisma)                                                                                                                                                                                                                                                                 |
| AI provider/model config                          | [src/config/ai.js](src/config/ai.js)                                                                                                                                                                                                                                                                         |
| Extraction entry point, reranking, firewall       | [src/services/ai.service.js](src/services/ai.service.js)                                                                                                                                                                                                                                                     |
| Normalized extraction and source mapping          | [src/services/extraction-normalizer.service.js](src/services/extraction-normalizer.service.js)                                                                                                                                                                                                               |
| Heading candidates, identity, hierarchy, sections | [heading-candidates.service.js](src/services/heading-candidates.service.js), [document-identity.service.js](src/services/document-identity.service.js), [heading-structure.service.js](src/services/heading-structure.service.js), [document-sections.service.js](src/services/document-sections.service.js) |
| Block collection and relationship resolution      | [document-blocks.service.js](src/services/document-blocks.service.js), [document-relations.service.js](src/services/document-relations.service.js)                                                                                                                                                           |
| Labelled units and token packing                  | [structured-units.service.js](src/services/structured-units.service.js), [token-packer.service.js](src/services/token-packer.service.js)                                                                                                                                                                     |
| Chunk orchestration, metadata and links           | [src/services/chunking.service.js](src/services/chunking.service.js)                                                                                                                                                                                                                                         |
| Shared embedding model and input measurement      | [src/services/embedding.service.js](src/services/embedding.service.js)                                                                                                                                                                                                                                       |
| Chunking regressions and offline model setup      | [tests/structured-chunking.test.js](tests/structured-chunking.test.js), [tests/offline-embedding-setup.js](tests/offline-embedding-setup.js)                                                                                                                                                                 |
| Ingestion pipeline (the worker)                   | [src/workers/document.worker.js](src/workers/document.worker.js)                                                                                                                                                                                                                                             |
| Upload progress (Pub/Sub helpers)                 | [src/config/uploadProgress.js](src/config/uploadProgress.js)                                                                                                                                                                                                                                                 |
| Chat entry point (firewall, history, streaming)   | [src/services/chat.service.js](src/services/chat.service.js)                                                                                                                                                                                                                                                 |
| CRAG graph (routing, splitting, grading, answers) | [src/services/crag.service.js](src/services/crag.service.js)                                                                                                                                                                                                                                                 |
| Hybrid search SQL, history, conversations         | [src/repositories/chat.repository.js](src/repositories/chat.repository.js)                                                                                                                                                                                                                                   |
| Auth logic                                        | [src/services/auth.service.js](src/services/auth.service.js), [src/controllers/auth.controller.js](src/controllers/auth.controller.js)                                                                                                                                                                       |
| Evaluation harness                                | [src/scripts](src/scripts), [src/evals](src/evals), [eval-docs](eval-docs)                                                                                                                                                                                                                                   |
| Architecture diagram                              | [docs/architecture.png](docs/architecture.png)                                                                                                                                                                                                                                                               |
| Migration workflow rules                          | [PRISMA_WORKFLOW.md](PRISMA_WORKFLOW.md)                                                                                                                                                                                                                                                                     |
