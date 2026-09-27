# Ai Rag — Product & Technical Overview

This document explains what this project does, how it is built, and how data
flows through it end to end — written so that someone with no prior context
can understand the whole system after reading it once.

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
   A document is uploaded, its text is extracted, cut into small overlapping
   pieces ("chunks"), and each piece is converted into a list of numbers (an
   "embedding") that captures its meaning. Those numbers are stored in a
   database that can search by *meaning* instead of just keywords. The user
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
   is instructed to answer *using only that text*, to cite where each fact
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
       │ summarize → save        │      │ Chunks, Chats)     │
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

| Layer | Technology | Why it's here |
|---|---|---|
| HTTP server | Express 5 | REST API + Server-Sent Events streaming |
| Database ORM | Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`) | Type-safe DB access, migrations |
| Database | PostgreSQL + `pgvector` extension | Stores relational data **and** embedding vectors in one place |
| Local dev infra | Docker Compose (`pgvector/pgvector:pg16`, `redis`, `pgadmin`) | Spin up Postgres+pgvector and Redis without installing them locally |
| Hosted infra option | Supabase (Postgres + Storage) | `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` used for file storage; the same Postgres can host the app DB |
| File storage | Supabase Storage (`documents` bucket) | Uploaded files are stored here, not on local disk (`multer` uses memory storage only) |
| Background jobs | BullMQ + Redis | Document processing (parsing/embedding/summarizing) happens off the request thread |
| Live progress | Redis Pub/Sub + SSE | The worker publishes chunking progress; an SSE endpoint streams it to the client |
| Document parsing | `llama-cloud-services` (LlamaParse), `pdf-parse`, `mammoth`, `cheerio`, `turndown` | Converts PDFs/DOCX/images into clean Markdown text, including OCR for scanned pages/tables/charts |
| Text splitting | `@langchain/textsplitters` | Breaks long text into overlapping chunks |
| Embeddings | `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384 dimensions) | Runs **locally**, no per-call API cost, converts text → vector |
| Orchestration | `@langchain/langgraph` | Runs the question-answering pipeline as a state machine (the CRAG graph) |
| Reranking | Cohere (`rerank-english-v3.0`) | A more accurate (but slower) second pass that re-scores the initial search results |
| LLMs | Groq or OpenRouter, via the OpenAI SDK (`openai` npm package pointed at a different `baseURL`) | `gpt-oss-120b` for planning and answers; `gpt-oss-20b` for fast checks and summaries (see §8.4) |
| Token counting | `gpt-tokenizer` | Keeps summarization batches under the per-call limit |
| Auth | `jsonwebtoken` + `bcryptjs` | Stateless JWT sessions, hashed passwords |
| Observability | LangSmith (`langsmith/traceable`) | Traces the pipeline's steps and LLM calls for debugging |

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
 ├─ userId → User
 ├─ ParentChunks[]
 └─ Conversations[]                    (chat threads scoped to this one document)

ParentChunk                            ("big" chunk — the unit that gets shown/cited)
 ├─ id, text, metadata (json: page_number, chunk_index)
 ├─ documentId → Document
 └─ ChildChunks[]

ChildChunk                             ("small" chunk — the unit that gets embedded/searched)
 ├─ id, text, metadata (json: page_number)
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
  more precise vector, so *searching* with small chunks finds more accurate
  matches.
- **Small chunks answer worse.** A 400-character snippet often lacks the
  surrounding context an LLM needs to answer correctly.

The fix: split each page into medium **parent** chunks (~1200 characters,
used for context/citations), then split each parent further into small
**child** chunks (~400 characters, used only for embedding/search). A search
matches on the precise child chunk, but the system returns its parent's full
text to the LLM — precise search, contextual answers.

---

## 6. Flow #1 — Authentication

Files: [auth.routes.js](src/routes/auth.routes.js) → [auth.controller.js](src/controllers/auth.controller.js) → [auth.service.js](src/services/auth.service.js) → [auth.repository.js](src/repositories/auth.repository.js)

| Endpoint | Method | What happens |
|---|---|---|
| `/api/auth/register` | POST | Hashes password with bcrypt, creates a `User` row |
| `/api/auth/login` | POST | Verifies password, issues a **JWT** (`jsonwebtoken`) valid for 7 days |
| `/api/auth/forgot-password` | POST | Generates a random 6-digit OTP, stores it with a 10-minute expiry on the `User` row |
| `/api/auth/reset-password` | POST | Verifies the OTP + expiry, hashes and saves the new password, clears the OTP |

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
   - **Extract**: `extractDocPages()` downloads the file from Supabase
     Storage, then:
     - PDFs, `.docx`, and images (`jpeg`/`png`/`webp`) → sent to **LlamaParse**
       in "premium" mode, which performs OCR/vision parsing and returns clean
       Markdown — including transcribing scanned exhibits, converting tables
       and charts into Markdown tables, and describing diagrams as
       structured bullet points. This is what lets the system handle scanned
       or image-heavy documents, not just clean digital text.
     - `.txt` / `.md` → read as plain text directly.
   - **Chunk (parent)**: each page's text is split into ~1200-character
     overlapping chunks (`RecursiveCharacterTextSplitter`), saved as
     `ParentChunk` rows tagged with `page_number` and `chunk_index`.
   - **Chunk (child) + embed**: each parent chunk is further split into
     ~400-character pieces. Each piece is embedded (384 numbers, via the
     local `Xenova/all-MiniLM-L6-v2` model in `getEmbedding()`) and inserted
     into `ChildChunk` via a raw SQL `INSERT ... VALUES (..., ${embeddingString}::vector, ...)`
     — Prisma's schema can declare the `vector` column type but can't build
     queries against it, hence the raw SQL.
   - **Summarize**: once every page is chunked and embedded, the worker
     rebuilds the full document text, splits it into token-bounded batches
     (~5000 tokens each, respecting paragraph/sentence boundaries so nothing
     is cut mid-thought), summarizes each batch with `gpt-oss-20b`, waits
     8.5 seconds between calls (to stay under Groq's per-minute token
     limit), then — if there was more than one batch — asks the LLM to
     combine all batch summaries into one master summary.
   - **Finish**: `Document.status` is set to `"COMPLETED"` and `Document.summary`
     is saved. If anything throws along the way, `status` is set to `"FAILED"`
     instead.

While a document is `"PROCESSING"` or `"FAILED"`, the chat endpoint refuses
to answer questions about it (see next section).

### 7.1 Live progress while a document processes

So the user sees progress instead of a blank screen, the worker publishes an
event to the Redis Pub/Sub channel `doc-progress:<documentId>` at every step
(`publishProgress()` in [uploadProgress.js](src/config/uploadProgress.js)).

`GET /api/documents/progress/:docId` (auth required, owner only) is an SSE
endpoint (`streamProgress()`) that subscribes to that channel and forwards
each event to the client:

| Event `type` | Fields | Meaning |
|---|---|---|
| `page_start` | `page`, `totalPages` | Started a page |
| `parent` | `page`, `parent`, `parentId`, `preview` | A parent chunk was saved |
| `child` | `page`, `parent`, `child`, `totalChildren` | A child chunk was embedded and saved |
| `summarizing` | – | All chunking done; generating the summary |
| `completed` | – | Document ready; the stream closes |
| `failed` | `message` | Processing failed; the stream closes |

If the document has already finished when the client connects, the endpoint
sends one `completed` or `failed` event and closes. The stream is live only:
events sent before the client connected are not replayed.

---

## 8. Flow #3 — Asking a question (Corrective RAG)

Files: [chat.routes.js](src/routes/chat.routes.js) → [chat.controller.js](src/controllers/chat.controller.js) → [chat.service.js](src/services/chat.service.js) → [crag.service.js](src/services/crag.service.js) + [chat.repository.js](src/repositories/chat.repository.js) + [ai.service.js](src/services/ai.service.js)

**Endpoint:** `POST /api/chat` (auth required)
**Body:** `{ question, documentId?, conversationId }`
`documentId` omitted = search across *all* of the user's documents instead
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

| Node | Model | What it does |
|---|---|---|
| `analyze_intent` | 20b | Sorts the question: `greeting`, `summary`, `page` (with a page number) or `search` |
| `fetch_summary` | – | Loads the pre-computed `Document.summary` |
| `fetch_page` | – | Loads every parent chunk on the requested page (`getChunksByPage()`) |
| `decompose` | 120b | Splits the question into up to 4 separate searches, one fact per search |
| `retrieve` | – | Runs each search: embed → hybrid search → Cohere rerank (top 3) → merge and remove duplicates |
| `grade` | 20b | Looks at **all** retrieved chunks in one call and keeps those that help any part of the answer |
| `rewrite` | 20b | If nothing was kept, writes a new search query (the user's question itself stays unchanged) |
| `generate` | 120b | Writes the final answer from the kept chunks, with citations |

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
- **Cohere's reranker** re-scores those candidates and keeps the best 3.

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

| Model | Config name | Used for |
|---|---|---|
| `gpt-oss-120b` | `MODELS.agent` | Question splitting (`decompose`), final answers (`generate`), eval generation and judging |
| `gpt-oss-20b` | `MODELS.fast` | Security firewall, intent routing, relevance grading, query rewriting |
| `gpt-oss-20b` | `MODELS.summary` | Document summaries in the worker |

### 8.5 SSE events

| `type` | Fields | Sent when |
|---|---|---|
| `status` | `message` | A stage changes, and once per graded chunk ("Chunk 2/6 (Page 3): relevant") |
| `tool_start` | `tool`, `query` | A step starts: Intent Classifier, Question Splitter, Hybrid Search, Relevance Grader, Query Rewriter, Summary Lookup, Page Retrieval |
| `tool_finish` | `tool`, `message` | That step finishes, with its result |
| `token` | `text` | One word of the final answer |
| `done` | – | Answer complete |
| `error` | `message` | Something failed mid-stream |

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

- **Authentication**: every route except auth and the two chunk-inspection
  routes requires a JWT.
- **Prompt-injection firewall**: `checkMaliciousIntent()` screens every
  question before retrieval (§8.1).
- **Untrusted-text wrappers**: retrieved text and questions are wrapped in
  randomly named tags, so instructions hidden inside a document are treated
  as data (§8.3).
- **Red-team testing**: the pipeline has been tested with documents
  containing hidden instructions, fake system tags, fake chat turns, forged
  citations and policy-shaped phishing instructions. Direct commands are
  resisted; false *facts* written into a document are still repeated as
  true, because the model cannot tell a real document from a lying one.

---

## 10. Evaluation

Scripts in [src/scripts](src/scripts), datasets in [src/evals](src/evals),
test documents in [eval-docs](eval-docs).

| Command | Document | Questions |
|---|---|---|
| `npm run seedEvals` / `npm run runEvals` | Drug and alcohol policy (`Sample-Policy-for-Drug-and-Alcohol-use.pdf`) | 10, in `goldenDataSet.js` |
| `npm run seedEvals2` / `npm run runEvals2` | Travel and expense policy (`Northwind-Travel-Expense-Policy.pdf`) | 25, in `goldenDataSet2.js`, scored per category |
| (dataset only) | Annual report with image-only charts, errata and addenda (`Kestrel-Annual-Operations-Report-FY2025.pdf`) | 36, in `goldenDataSet3.js` |

- **Seed scripts** upload the PDF, parse and chunk it exactly like the
  worker, and give every parent chunk a fixed id, so each golden question
  can name the chunk(s) that contain its answer.
- **Run scripts** measure retrieval (MRR and Recall@3 against those chunk
  ids; multi-chunk targets must all be retrieved) and use `gpt-oss-120b` as
  an LLM judge for **faithfulness** (is the answer grounded in the context?)
  and **relevance** (does it match the expected answer?).
- `goldenDataSet3.js` has no seed/run scripts yet, and its target chunk ids
  are still placeholders.
- The run scripts use a simple answer prompt, not the full CRAG graph, so
  they measure retrieval plus one LLM call rather than exactly what users
  get.

---

## 11. Full API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account |
| POST | `/api/auth/login` | – | Get JWT |
| POST | `/api/auth/forgot-password` | – | Issue OTP |
| POST | `/api/auth/reset-password` | – | Consume OTP, set new password |
| POST | `/api/documents/upload` | ✅ | Upload a file, kicks off ingestion |
| GET | `/api/documents/progress/:docId` | ✅ | Live processing progress (SSE) |
| GET | `/api/documents/` | ✅ | List **all** documents in the system |
| GET | `/api/documents/my-documents` | ✅ | List the current user's documents |
| DELETE | `/api/documents/:docId` | ✅ | Delete a document you own (see [docs/delete-document-api.md](docs/delete-document-api.md)) |
| GET | `/api/documents/get-all-parent-chunk/:docId` | – | Debug: inspect a document's parent chunks |
| GET | `/api/documents/get-all-child-chunk/:parentId` | – | Debug: inspect a parent's child chunks + text |
| POST | `/api/chat` | ✅ | Ask a question (SSE streaming response) |
| GET | `/api/chat/conversation` | ✅ | Get/create the chat thread + history |
| DELETE | `/api/chat/conversation` | ✅ | Clear the chat thread's messages |

---

## 12. Known limitations

- **Access control**: `GET /api/documents/` returns every user's documents;
  `POST /api/chat` does not check that the `documentId` belongs to the
  caller; and the two chunk-inspection routes have no auth at all.
- **Rate limits on large uploads**: summary batches can exceed Groq's free
  per-minute token limit on long documents, and a summary failure marks the
  whole (already searchable) document `FAILED`. There is no automatic retry
  on `429` responses.
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
  *meaning* of a piece of text, produced by a machine learning model. Texts
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
- **Chunking** — splitting a long document into smaller overlapping pieces,
  because embeddings work best on short, focused text and LLMs have limited
  context windows. See §5 for why this project uses **parent/child**
  chunking specifically.
- **Hybrid search** — combining vector (semantic/meaning-based) search with
  traditional keyword/full-text search, so the system catches both "things
  that mean the same thing" and "things that literally contain this exact
  word/number/code."
- **Reciprocal Rank Fusion (RRF)** — a simple, effective way to merge two
  differently-scored ranked lists into one: each item's score becomes
  `1 / (k + its rank position)`, and scores are summed across lists. No
  need to normalize or compare the two scoring systems directly.
- **Reranking / cross-encoder** — a second, more expensive search pass that
  looks at the *query and each candidate together* (rather than comparing
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
  by Redis. The upload request just *enqueues* a job and returns instantly;
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

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Prisma's connection to the PostgreSQL database |
| `REDIS_URL` | BullMQ job queue and upload-progress Pub/Sub |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Supabase client — file storage (`documents` bucket) |
| `JWT_SECRET` | Signing/verifying login tokens |
| `AI_PROVIDER` | `"groq"` (default) or `"openrouter"` — selects which LLM provider config to use |
| `GROK_API_KEY` | API key for Groq (when `AI_PROVIDER=groq`) |
| `OPENROUTER` | API key for OpenRouter (when `AI_PROVIDER=openrouter`) |
| `COHERE_API_KEY` | Reranking search results |
| `LLAMA_CLOUD_API_KEY` | LlamaParse document parsing/OCR |
| `PORT` | Express server port (defaults to `3000`) |

Local infra (Postgres+pgvector, Redis, pgAdmin) can be started with
`docker-compose up` — see [docker-compose.yml](docker-compose.yml). Schema
changes go through Prisma Migrate — see [PRISMA_WORKFLOW.md](PRISMA_WORKFLOW.md)
for the exact commands and rules used in this project.

---

## 15. Where to look for each concern

| Concern | File(s) |
|---|---|
| HTTP entrypoint, wiring | [server.js](server.js) |
| DB schema | [prisma/schema.prisma](prisma/schema.prisma) |
| AI provider/model config | [src/config/ai.js](src/config/ai.js) |
| Document parsing, embeddings, reranking, firewall | [src/services/ai.service.js](src/services/ai.service.js) |
| Ingestion pipeline (the worker) | [src/workers/document.worker.js](src/workers/document.worker.js) |
| Upload progress (Pub/Sub helpers) | [src/config/uploadProgress.js](src/config/uploadProgress.js) |
| Chat entry point (firewall, history, streaming) | [src/services/chat.service.js](src/services/chat.service.js) |
| CRAG graph (routing, splitting, grading, answers) | [src/services/crag.service.js](src/services/crag.service.js) |
| Hybrid search SQL, history, conversations | [src/repositories/chat.repository.js](src/repositories/chat.repository.js) |
| Auth logic | [src/services/auth.service.js](src/services/auth.service.js), [src/controllers/auth.controller.js](src/controllers/auth.controller.js) |
| Evaluation harness | [src/scripts](src/scripts), [src/evals](src/evals), [eval-docs](eval-docs) |
| Architecture diagram | [docs/architecture.png](docs/architecture.png) |
| Migration workflow rules | [PRISMA_WORKFLOW.md](PRISMA_WORKFLOW.md) |
