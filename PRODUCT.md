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

There is no frontend in this repository — it is a **Node.js/Express REST +
streaming API** meant to be driven by a separate client application.

---

## 2. The core idea in plain language

1. **Ingestion (offline, happens once per document):**
   A document is uploaded, its text is extracted, cut into small overlapping
   pieces ("chunks"), and each piece is converted into a list of numbers (an
   "embedding") that captures its meaning. Those numbers are stored in a
   database that can search by *meaning* instead of just keywords.

2. **Retrieval (happens per question):**
   When a user asks something, their question is also converted into numbers
   using the same method, and the database is searched for the stored chunks
   whose numbers are mathematically closest to the question's numbers —
   i.e., the chunks that mean something similar to the question.

3. **Generation (happens per question):**
   The best-matching chunks of text are handed to an LLM (large language
   model) along with the user's question, and the LLM is instructed to
   answer *using only that text* and to cite where each fact came from.

Everything in this codebase exists to implement those three steps reliably,
plus user accounts and conversation history around them.

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
        ┌────────────────┐   ┌───────────────────────┐
        │ Supabase        │   │  Agentic RAG loop      │
        │ Storage         │   │  (LLM + tool calling)  │
        │ (raw files)     │   └─────────┬─────────────┘
        └───────┬─────────┘             │ vector + keyword search
                │ queues a job          ▼
                ▼                 ┌───────────────────┐
        ┌────────────────┐        │ PostgreSQL +       │
        │ Redis (BullMQ)  │        │ pgvector           │
        │ job queue       │        │ (Users, Documents, │
        └───────┬─────────┘        │ Chunks, Chats)     │
                │ picked up by      └────────────────────┘
                ▼
        ┌────────────────────────────┐
        │ Background Worker            │
        │ parse → chunk → embed →     │
        │ summarize → save            │
        └────────────────────────────┘
```

External AI services used along the way: **LlamaParse** (document OCR/parsing),
a local **Xenova/transformers** model (embeddings), **Groq or OpenRouter**
(the LLM that reasons and answers), **Cohere** (reranking search results),
and **LangSmith** (tracing/observability of the AI calls).

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
| Document parsing | `llama-cloud-services` (LlamaParse), `pdf-parse`, `mammoth`, `cheerio`, `turndown` | Converts PDFs/DOCX/images into clean Markdown text, including OCR for scanned pages/tables/charts |
| Text splitting | `@langchain/textsplitters` | Breaks long text into overlapping chunks |
| Embeddings | `@xenova/transformers` (`Xenova/all-MiniLM-L6-v2`, 384 dimensions) | Runs **locally**, no per-call API cost, converts text → vector |
| Reranking | Cohere (`rerank-english-v3.0`) | A more accurate (but slower) second pass that re-scores the initial search results |
| LLM (chat/agent/summary) | Groq or OpenRouter, via the OpenAI SDK (`openai` npm package pointed at a different `baseURL`) | Reasoning, tool calling, answer generation, summarization |
| Token counting | `gpt-tokenizer` | Keeps summarization batches under the model's context limit |
| Auth | `jsonwebtoken` + `bcryptjs` | Stateless JWT sessions, hashed passwords |
| Observability | LangSmith (`langsmith/traceable`) | Traces the agent's reasoning steps and RAG loop for debugging |

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

Files: [document.routes.js](src/routes/document.routes.js) → [document.controller.js](src/controllers/document.controller.js) → [document.service.js](src/services/document.service.js) → [document.worker.js](src/workers/document.worker.js) → [ai.service.js](src/services/ai.service.js)

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
   - **Extract**: downloads the file from Supabase Storage, then:
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
     local `Xenova/all-MiniLM-L6-v2` model) and inserted into `ChildChunk`
     via a raw SQL `INSERT ... VALUES (..., ${embeddingString}::vector, ...)`
     — Prisma's schema can declare the `vector` column type but can't build
     queries against it, hence the raw SQL.
   - **Summarize**: once every page is chunked and embedded, the worker
     rebuilds the full document text, splits it into token-bounded batches
     (~5000 tokens each, respecting paragraph/sentence boundaries so nothing
     is cut mid-thought), summarizes each batch with the LLM, waits 2.5s
     between calls (to stay under Groq's rate limit), then — if there was
     more than one batch — asks the LLM to synthesize all batch summaries
     into one master summary.
   - **Finish**: `Document.status` is set to `"COMPLETED"` and `Document.summary`
     is saved. If anything throws along the way, `status` is set to `"FAILED"`
     instead.

While a document is `"PROCESSING"` or `"FAILED"`, the chat endpoint refuses
to answer questions about it (see next section).

---

## 8. Flow #3 — Asking a question (agentic RAG)

Files: [chat.routes.js](src/routes/chat.routes.js) → [chat.controller.js](src/controllers/chat.controller.js) → [chat.service.js](src/services/chat.service.js) → [chat.repository.js](src/repositories/chat.repository.js) + [ai.service.js](src/services/ai.service.js)

**Endpoint:** `POST /api/chat` (auth required)
**Body:** `{ question, documentId?, conversationId? }`
`documentId` omitted = search across *all* of the user's documents instead
of one.

This is **not** a simple "embed → search → answer" pipeline. It's an
**agent**: the LLM itself decides, step by step, whether it needs to search
and what to search for, using OpenAI-style **tool calling** (also called
function calling). This is a ReAct-style loop (Reason → Act → Observe,
repeated).

1. The user's message is saved to the `Message` table, and the last 6
   messages of chat history are fetched for context.
2. The API responds with **Server-Sent Events (SSE)** — a long-lived HTTP
   connection over which the server pushes a stream of small JSON events
   (`status`, `tool_start`, `tool_finish`, `token`, `done`, `error`) as they
   happen, so the client can show live "thinking"/typing indicators instead
   of waiting for one big response.
3. The LLM is given two tools it's allowed to call:
   - **`search_corporate_database(search_query, page_number?)`** — search the
     document(s) for relevant text, or jump straight to a specific page if
     the user asked for one by number.
   - **`get_document_summary()`** — return the pre-computed summary from
     ingestion, for "summarize the whole document" type questions.
4. **Loop** (capped at 5 iterations as a safety circuit breaker):
   - Call the LLM with the conversation so far.
   - If it responds with a **tool call**, run it:
     - **Page lookup** → direct DB query for `ParentChunk`s on that page.
     - **Semantic + keyword search** → this is a **hybrid search**:
       - the query is embedded (same 384-dim model as ingestion) and matched
         against `ChildChunk.embedding` using pgvector's cosine-distance
         operator (`<=>`), top 20 by vector similarity;
       - *in parallel*, a Postgres full-text search (`ts_rank_cd` /
         `plainto_tsquery`) finds the top 20 by keyword/lexical match — this
         catches exact terms (names, numbers, codes) that embeddings can
         blur together;
       - the two ranked lists are merged with **Reciprocal Rank Fusion
         (RRF)** — each result's score is `1 / (60 + its rank)`, summed
         across both lists — so a chunk that ranks well in *either* method
         (or both) rises to the top;
       - results are grouped up from child chunks to their **parent**
         chunks (so the LLM gets full context, not a fragment);
       - the top ~20 candidate parents are then re-scored by **Cohere's
         reranker** (a more accurate but more expensive cross-encoder model)
         to pick the best 3 — a classic "cheap broad recall pass, then
         expensive precise re-ranking pass" pipeline;
       - a duplicate-search guard (`previousSearches` set) stops the agent
         from looping forever on the same query.
     - Each retrieved chunk is tagged as `[Source ID: Page N]` before being
       handed back to the LLM as the tool's result — this is what makes
       later inline citations like `"revenue grew 15% [Source ID: Page 4]"`
       possible; the system prompt requires every factual claim to cite one.
   - If the LLM responds with **no tool call**, it has decided it's ready to
     answer — the loop ends.
   - If 5 iterations pass without an answer, the agent is force-stopped and
     told to answer immediately with whatever it has gathered so far.
5. The final answer is streamed to the client **word by word** (a 20ms delay
   between words, purely for a smooth "typing" UI effect — the answer itself
   is already fully generated at this point) as `token` SSE events, then an
   `assistant` `Message` row is saved and a `done` event closes the stream.

### Conversation sessions

`GET /api/chat/conversation?documentId=...` (auth required) fetches-or-creates
the single ongoing `Conversation` for this user (+ this document, if given),
including its full message history — this is what a client calls on page
load to restore a chat thread.

---

## 9. Full API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | – | Create account |
| POST | `/api/auth/login` | – | Get JWT |
| POST | `/api/auth/forgot-password` | – | Issue OTP |
| POST | `/api/auth/reset-password` | – | Consume OTP, set new password |
| POST | `/api/documents/upload` | ✅ | Upload a file, kicks off ingestion |
| GET | `/api/documents/` | ✅ | List **all** documents in the system |
| GET | `/api/documents/my-documents` | ✅ | List the current user's documents |
| GET | `/api/documents/get-all-parent-chunk/:docId` | – | Debug: inspect a document's parent chunks |
| GET | `/api/documents/get-all-child-chunk/:parentId` | – | Debug: inspect a parent's child chunks + text |
| POST | `/api/chat` | ✅ | Ask a question (SSE streaming response) |
| GET | `/api/chat/conversation` | ✅ | Get/create the chat thread + history |

> Note: `GET /api/documents/` currently returns every document regardless of
> owner (looks like an admin/debug listing rather than a per-user one — see
> `/my-documents` for the user-scoped version), and the two chunk-inspection
> routes have no `requireAuth` guard at all. Worth tightening if this API is
> exposed beyond trusted/internal use.

---

## 10. Glossary — technical terms used in this project

- **RAG (Retrieval-Augmented Generation)** — answering questions by first
  retrieving relevant text from a knowledge base, then having an LLM
  generate an answer grounded in that text, instead of relying purely on
  what the model memorized during training.
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
  `1 / (60 + its rank position)`, and scores are summed across lists. No
  need to normalize or compare the two scoring systems directly.
- **Reranking / cross-encoder** — a second, more expensive search pass that
  looks at the *query and each candidate together* (rather than comparing
  precomputed vectors) to produce a more accurate relevance ranking. Used
  here (via Cohere) to narrow ~20 broad candidates down to the best 3.
- **Tool calling / function calling** — a way of prompting an LLM with a
  list of functions it's allowed to "call" (here: search the database, or
  fetch a summary). The model outputs a structured request to call one, the
  application actually runs it, and feeds the result back to the model.
- **Agent / ReAct loop** — an LLM usage pattern where the model doesn't just
  answer in one shot, but repeatedly reasons about what it needs, calls a
  tool, observes the result, and decides whether to search again or answer
  — implemented here as the `while (iterations < MAX_STEPS)` loop in
  [chat.service.js](src/services/chat.service.js).
- **SSE (Server-Sent Events)** — a simple one-way streaming protocol over
  plain HTTP, used here to push live progress (`status`, `tool_start`,
  `token`, ...) to the client while the agent is still working, instead of
  making it wait for one big JSON response.
- **JWT (JSON Web Token)** — a signed, tamper-proof token issued at login
  that encodes the user's identity; sent on every subsequent request in the
  `Authorization` header instead of a server-side session.
- **BullMQ / Redis queue / worker** — BullMQ is a job queue library backed
  by Redis. The upload request just *enqueues* a job and returns instantly;
  a separate long-running `Worker` process (started alongside the API
  server here) pulls jobs off the queue and does the slow work
  (parsing/embedding/summarizing) asynchronously.
- **LangSmith / `traceable`** — an observability tool for LLM applications.
  Wrapping a function in `traceable(...)` records its inputs/outputs/timing
  to LangSmith so the agent's reasoning steps can be inspected after the
  fact for debugging.
- **OTP (One-Time Password)** — the 6-digit, time-limited code used in the
  forgot-password flow to prove the requester controls the account's email,
  before allowing a password reset.

---

## 11. Environment variables

| Variable | Used for |
|---|---|
| `DATABASE_URL` | Prisma's connection to the PostgreSQL database |
| `REDIS_URL` | BullMQ's connection to Redis (job queue) |
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

## 12. Where to look for each concern

| Concern | File(s) |
|---|---|
| HTTP entrypoint, wiring | [server.js](server.js) |
| DB schema | [prisma/schema.prisma](prisma/schema.prisma) |
| AI provider/model config | [src/config/ai.js](src/config/ai.js) |
| Document parsing + embeddings + LLM calls | [src/services/ai.service.js](src/services/ai.service.js) |
| Ingestion pipeline (the worker) | [src/workers/document.worker.js](src/workers/document.worker.js) |
| Agentic RAG / chat orchestration | [src/services/chat.service.js](src/services/chat.service.js) |
| Hybrid search SQL | [src/repositories/chat.repository.js](src/repositories/chat.repository.js) |
| Auth logic | [src/services/auth.service.js](src/services/auth.service.js), [src/controllers/auth.controller.js](src/controllers/auth.controller.js) |
| Migration workflow rules | [PRISMA_WORKFLOW.md](PRISMA_WORKFLOW.md) |
