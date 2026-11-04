# Project instructions

## Change approval

- Do not edit, create, delete, rename, format, or auto-fix project files unless the user explicitly asks you to make that change or approves a specific proposed change. This includes code, tests, configuration, migrations, and documentation.
- A request to explain, inspect, review, debug, or plan is read-only. You may read files and suggest changes, but do not apply them.
- A clear request such as "fix this bug" or "implement this feature" authorizes the changes needed for that request. Keep edits within its scope; ask before making additional unrelated changes.
- If the user's intent to modify files is unclear, describe the proposed edit and ask for approval before writing.
- Do not run database migrations, seeds, destructive commands, or actions that change external services without an explicit request or approval.

## Project map

- This repository is a Node.js ES-module Express backend for chat over uploaded documents. There is no frontend here. `server.js` mounts `/api/auth`, `/api/documents`, `/api/chat`, and `/api/health`, and starts the document worker.
- Code is organized as `src/routes` -> `src/controllers` -> `src/services` -> `src/repositories`; `src/config` holds clients and infrastructure. Auth uses JWT via `src/middlewares/auth.middleware.js`.
- Ingestion: upload to Supabase Storage, enqueue a BullMQ job in Redis, then `src/workers/document.worker.js` extracts pages, creates parent/child chunks, embeds child chunks, stores them in PostgreSQL/pgvector, and summarizes the document. Progress uses Redis Pub/Sub and SSE.
- Chat: `src/services/chat.service.js` runs an input security check, loads history, invokes the LangGraph corrective RAG pipeline in `src/services/crag.service.js`, and streams an answer through SSE. Search, neighbor expansion, and conversation persistence live in `src/repositories/chat.repository.js`. Hop-plan helpers live in `src/services/hop-evidence.service.js`.
- Database schema and migrations are in `prisma/`; Prisma Client is generated into `generated/prisma`. `src/config/db.js` uses the PostgreSQL driver adapter. Follow `PRISMA_WORKFLOW.md` for approved schema changes.
- For deeper context, read only the relevant sections of `PRODUCT.md`, `docs/chat-pipeline.md`, and `docs/delete-document-api.md`. Treat docs as orientation and verify details against current code.
- `npm test` is a placeholder that exits with an error; use relevant targeted tests when changes are authorized.

## Current pipeline (reviewed 4 November 2026)

### AI routing and limits

- `src/config/ai.js` exposes `getAI(task)` and `chatCompletion(task, options)` for `extraction`, `summary`, `chat`, `agent`, and `fast`. `DEFAULT_TASK_PROVIDERS` in code is the single source of truth: extraction -> gemini, summary/chat/agent -> airouter, fast -> groq. `AI_PROVIDER` is hardcoded to `"mixed"`; environment `AI_PROVIDER`, `AI_<TASK>_PROVIDER`, and `AI_<TASK>_MODEL` overrides are no longer read. Providers: gemini, groq, openrouter, opencode, airouter (`AI_ROUTER_BASE_URL` overrides its base URL). Read `PROVIDERS` for the current model per task rather than assuming one. Local embeddings and Cohere reranking are separate from this routing.
- `src/config/rag.config.js` has two limit profiles. The larger one is selected when env `AI_PROVIDER` or `AI_AGENT_PROVIDER` equals `opencode`. Because `ai.js` no longer reads those variables, the limit profile and the actual provider routing can disagree. Standard profile: `MAX_SUB_QUERIES` 3, vector/keyword tier limits 20, `SEARCH_PARENT_CANDIDATES` 15, `RERANK_TOP_N` 4, `MAX_TOTAL_CHUNKS_PER_ROUND` 10, `EXPANSION_SEED_COUNT` 2, `MAX_CRAG_LOOPS` 3. Larger profile: 4, 30, 25, 8, 16, 4, 6.

### Ingestion

- Two readiness states: `Document.status` tracks ingestion (`PROCESSING`, `COMPLETED`, `FAILED`); `summaryStatus` tracks summary generation (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`). Chunks are saved before `status=COMPLETED`; questions can run while the summary is still being generated, and summary failure leaves searchable chunks available. Summary requests must check `summaryStatus` and saved summary content.
- Extraction was reworked after 5 October. `aiService.extractDocPages()` calls `extractDocument()`, which uses the `extraction` AI task (Gemini by default) in page batches with a contents-outline pass (`src/services/document-outline.service.js`). LlamaParse is no longer referenced in `ai.service.js`. Extraction prompts are requests to a model, not structural guarantees.
- Chunking now lives in `src/services/simple-chunking.service.js` (`buildDocumentChunks`, version `ai-corrected-markdown-v3`), exposed through `aiService.buildDocumentChunks()`. It parses Markdown with remark/GFM and uses token budgets measured with the embedding tokenizer (parent 1,024, child 256). It builds a `document-identity-v1` identity (extracted title or filename fallback) and writes metadata including `chunker_version`, `table_ids`, `linked_table_ids`, `is_toc`, and `references`/`cross_references`. The old `chunking.service.js` and `section-context-v1` no longer exist. Heading rules, table-continuation logic, and the exact `searchText` format were not re-reviewed on 4 November; read the source before describing them.
- Parents and children keep `text` (source passage) and required `searchText` (contextual text used for search, reranking, grading, and generation). Parent `prevParentId`/`nextParentId` are nullable strings for same-section reading order, not Prisma self-relations or semantic references. Chunks are saved together in a transaction by `saveDocumentChunks()`.
- Child `searchText` is embedded with `Xenova/all-MiniLM-L6-v2` into normalized 384-dimensional vectors. Input is checked against a 256-token limit and rejected (`EMBEDDING_INPUT_TOO_LARGE`) instead of silently truncated.

### Hybrid search (`chat.repository.js`)

- A search query is either a planner object `{ text, keywords, identifiers, entities }` or a plain string (follow-up, rewrite, and eval-script queries). `buildSearchTiers()` (exported) converts either form into:
  - `idPatterns`: identifiers of at least 3 characters as `%ID%` patterns.
  - `phraseQuery`: entities as adjacent-word tsquery phrases, e.g. `(new <-> zealand) | (audit <-> committee)`.
  - `wordQuery`: planner keywords, or every useful word of the text when no keywords are given, sanitized by `buildRelaxedTsQuery()` (stop words removed, terms joined with `|`, empty string when nothing useful remains).
- `searchSingleDocument()` and `searchAllUserDocuments()` run four child-level tiers, skipping a tier whose input is empty: vector (pgvector cosine distance), identifier (`"searchText" ILIKE ANY(...)`), phrase, and keyword (both `to_tsquery('english', ...)` ranked by `ts_rank_cd`). Each tier sorts by rank before its `LIMIT`. Table-of-contents chunks (`is_toc`) are excluded. This is not BM25.
- Weighted RRF with k=10 in both functions sums per parent: vector 1.0, identifier 2.5, phrase 1.5, keyword 1.0. The top `SEARCH_PARENT_CANDIDATES` parents are returned (all-documents search uses at least 20 candidates and tier limits of at least 30). All-documents search only uses the newest `COMPLETED` document per filename.
- Known limits: the final `SELECT` has no `ORDER BY`, so candidates do not arrive sorted by `retrievalScore`, and the Cohere-failure fallback (`chunks.slice(0, topN)`) takes an arbitrary subset. The identifier tier has no index. Because `searchText` includes the filename prefix, an identifier that appears in a filename matches every chunk of that file.

### CRAG (`crag.service.js`)

- `analyze_intent` routes greeting -> `generate`, summary -> `fetch_summary`, page -> `fetch_page`, and other questions -> `decompose`.
- `decompose` (agent task) returns a hop plan (at most 12 hops with `dependsOn`) and starting queries. Prompt rule 10 asks for a short standalone `text`, 2-6 `keywords` without vague words, exact `identifiers`, and multi-word `entities`, with one worked example. Responses are normalized to objects (plain strings are still accepted), entries without text are dropped, and queries are deduplicated by `queryKey(text)` and capped at `MAX_SUB_QUERIES`. There are two planning attempts; failure routes to `generate` with a `planning_failed` reply and never searches the raw question.
- `retrieve` runs all queries in parallel (`Promise.all`). Query `text` is used for the embedding, Cohere rerank, events, `allQueries`, and `searchRounds`. Only the repository receives the full object. Cohere reranks parent `searchText` to `RERANK_TOP_N` per query and falls back to top search hits on failure. Collected parents keep Map insertion order, which depends on which parallel query finished first.
- `getParentNeighbors()` expands the first `EXPANSION_SEED_COUNT` collected parents, capped at `MAX_TOTAL_CHUNKS_PER_ROUND`. Each added parent records the expansion type in `retrievalOrigin.type`: `section_sibling` (prev/next), `section_lead` (when `section_part_index > 0`), `chapter_expansion` (when the question mentions process/step/flow/procedure/overview/policy/guide/sop), `table_continuation` (`table_ids`/`linked_table_ids`), and `reference_following` (only for override references like appendix/amendment, references cited in the question, or relevant table-of-contents/guide lines).
- `grade` evaluates evidence in one batch and tracks hop progress. Routing after grading: stop reason -> `generate`; missing hop -> `next_hop` -> `retrieve`; otherwise `rewrite` -> `retrieve` (or `generate` on stop). Rounds are capped by `MAX_CRAG_LOOPS`. Grader failure keeps up to `GRADER_FALLBACK_CHUNKS`. Passing relevance does not prove every requested fact is covered.
- Follow-up (`next_hop`) and rewrite queries are plain strings: they get no identifier or phrase tiers, and their keyword tier uses every useful word of the text.

## Inspection and frontend handoff

- `docs/frontend-chunk-inspector.md` documents payloads and responses. Verify it against current code: its 24-hour Redis replay description is stale. There is no frontend implementation in this repository.
- Authenticated inspection routes: `GET /api/documents/get-all-parent-chunk/:docId` returns stored parents with `text`, `searchText`, metadata, previous/next IDs, and `totalChildren`; `GET /api/documents/get-all-child-chunk/:parentId` returns the parent plus children with contextual text, metadata, vectors, and `embeddingDimensions`. Controllers check document ownership.
- `GET /api/documents/progress/:docId` streams ingestion progress live only: `uploadProgress.js` `getProgressHistory()` returns `[]` and clearing history is a no-op. Refresh cannot recover extracted pages or the old event timeline; rebuild saved views through REST. Do not present missing live page data as a measured zero.
- Chat is `POST /api/chat` returning SSE (`data: <json>`). The Question Splitter `tool_finish` event carries `queries` (strings) and `searchTiers` (query objects). Other events include `retrieval_candidates` and `rerank_result` (per query: `attempt`, query text, `documents`), `neighbor_expansion`, `retrieved_chunks`, `grading_result`, plus status/tool/`token`/`done`/`error`. The answer is generated first, then sent as word `token` events. `chat.service.js` saves all non-token events as `metadata.steps` on the assistant message when the answer is non-empty.
- Planned, not implemented: per-tier ranks and `matchedBy` on candidates, `retrievalRank`/`rerankRank`/`rerankApplied`/`searchInputs` in events, and a final `ORDER BY r.total_score DESC`.
- Verbose JSON logs use `[Document pipeline]`, `[Chunking]`, and `[CRAG details]`; search functions also log `SEARCH DEBUG` with the tier inputs. `RAG_DEBUG=false` suppresses `[CRAG details]` and other detailed logs, not every log.

## Recent work and migration context

- 3-4 October: task-based AI routing, separate ingestion/summary readiness, contextual chunking, neighbor expansion, inspection fields, detailed events/logs, and embedding token checks were integrated. The user explicitly approved a development DB reset and migration application on 4 October. This is history, not standing authorization to reset again.
- After 5 October (details not reviewed here): extraction moved to AI-model extraction with a contents outline, chunking moved to `simple-chunking.service.js`, neighbor expansion gained section-lead/chapter/table/reference expansion, CRAG gained hop plans and parallel retrieval, and AI routing moved into code with the airouter provider.
- 4 November: hybrid search tiers were added by the user, guided step by step: structured planner queries, identifier/phrase/keyword tiers with weighted RRF, planner-chosen keywords, per-tier `ORDER BY` fixes, the empty-tsquery crash fix, and `searchAllUserDocuments` parity. The planner `text` rules were added because the airouter agent model copied the raw question into search queries.
- Schema changes are recorded in `20261003120000_add_document_summary_status` and `20261004112441_contextual_chunking`. The latter adds required parent/child `searchText`, parent link fields, and a GIN full-text index on child `searchText`. It assumes empty chunk tables; do not apply it to populated data without an approved data plan.
- Schema edits, applying migrations, and generating Prisma Client are separate steps. Run `prisma generate` explicitly when needed with the installed Prisma 7 workflow. An earlier migration drops vector indexes, so do not claim a live HNSW index exists without checking it. Do not edit applied migration files.

## Confirmed gaps and next work (not implemented)

- Search: follow-up and rewrite queries should carry tiers; candidates need a final score `ORDER BY`; live per-tier tracking is still planned (see the inspection section); the `rag.config.js` profile selection should be aligned with the in-code AI routing.
- The stress-test findings below were diagnosed on 5 October with the old `section-context-v1` chunker. The current chunker adds table and reference metadata, but these cases have not been re-tested. Re-upload and re-check before claiming them fixed or still broken.
- Stress document: `Chunking_Stress_Test_Document.pdf`. Earlier compared uploads `ec020eb3-9aff-44cf-ae63-2f361bfa32e2` (after parsing prompt update) and `c57f4a08-8043-48b5-88f3-d01bad4aab85` (before) are development examples, not permanent identifiers.
- Old findings: heading hierarchy depended on extraction formatting (section 5A lost the handbook subtitle, section 18 nested under 17, section 19 lost document headings); page 4 rows D08-D12 were assigned to section 6 although they continue section 5's table; section 5A had no reference link to section 5; page 11's Kettleby row had no column labels in its parent or child.
- Kettleby facts for evaluation: correct city-proper population on 31 December 2023 is 163,482; 158,744 is the 1 January 2022 census, and 361,092 is the metropolitan figure. The full context behind the earlier wrong answer was not captured, so do not assert the exact generation failure.
- Do not claim tables are atomic, multi-hop dependencies are solved, or chunking errors are impossible.
