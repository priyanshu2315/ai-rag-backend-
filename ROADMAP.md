# Roadmap

15 days, 6 stages, ~60 hours (~4 hours/day), starting Wednesday 4 November 2026.

Legend: `[x]` done · `[~]` partly done / done differently · `[ ]` not started

## Step 1: Search Optimization & structured-context-v4 Part 2 (16 hrs)

### Nov 4 (4 hrs)
- [x] Replace `plainto_tsquery` (keyword search optimization)
  - Done with custom `buildSearchTiers()`: identifier (`ILIKE`), phrase, and keyword tiers plus weighted RRF. `websearch_to_tsquery` was not used because it ANDs words and splits IDs.
- [x] Fix duplicate question injection in history
  - History is now loaded before the current question is saved (`chat.service.js`).
- [x] Add token-budget trimming
  - History budget in `getChatHistory()`: last 4 messages up to 3,000 chars, older ones 200 chars. Retrieved context was already capped by `MAX_CONTEXT_CHARS`.

### Nov 5 (4 hrs)
- [~] Multi-hop pointer expansion (K-hop backward/forward along `prevParentId`/`nextParentId`)
  - Exists today: only immediate prev/next (`section_sibling`) and `section_lead`.
- [~] `section_id` window retrieval
  - Exists today: `chapter_expansion` only when the question mentions process/step/flow/etc.

### Nov 6 (4 hrs)
- [~] Explicit `references` metadata traversal
  - Exists today: `reference_following`, only for override references, references cited in the question, or ToC/guide lines.
- [~] Full `table_id` and `list_id` sibling chunk completion
  - Exists today: `table_continuation` via `table_ids`/`linked_table_ids`. No `list_id`.

### Nov 7 (4 hrs)
- [x] Upgrade decompose for sequential two-stage dependent lookups
  - Planner rule 7 "one hop = one lookup" (generic example, not from a test document). Verified 7 Nov: "name of the person who owns the risk linked to the Hosur expansion project" planned as 3 hops (project -> risk ID -> owner role -> name), each resolved in its own round with `inputBindings` filled.
  - Grader `next_query` and the rewriter now return the same `{ text, keywords, identifiers, entities }` object as the planner (`toSearchQuery()`), so follow-up rounds run ID and Name search too.
  - Also verified 8 Nov on a second document (KHI annual report): 3 chain questions, all correct in 2 rounds.
- [ ] Planner fixes from the 8 Nov KHI traces (next task)
  - Rule 7 adds "if needed" name hops even when the previous hop already gives a name.
  - "Who had to approve" was looked up directly instead of amount -> approval-threshold table; the table only arrived as a neighbor chunk.
  - Planning takes 27-33 s (2,600-3,400 hidden-thinking tokens) vs about 7 s before rule 7.
- [ ] Validate on `Chunking_Stress_Test_Document.pdf` (then build only the Nov 5/6 gaps it shows)

### Extra work done in Step 1 (not in the original plan)
- [x] Planner returns `{ text, keywords, identifiers, entities }` per query
- [x] Per-tier `ORDER BY` before `LIMIT`, empty-tsquery crash fix, `searchAllUserDocuments` parity
- [x] Live search tracking: `matchedBy`, per-tier ranks, `retrievalRank`/`rerankRank`/`rerankApplied`/`searchInputs`, final `ORDER BY total_score`
- [x] BigInt serialization fix (`::int` on counts)
- [x] Search query output check for rewriter and grader `next_query` (`cleanSearchQuery`, `invalid_query` stop reason)
- [x] Grader moved from `fast` (gpt-oss-20b) to `agent` (deepseek-v4-flash): follow-up went from 3 rounds to 1
- [x] Grader quotes that skip lines: accepted when at least 80% of the quote's lines appear in order (`isQuoteInDocText`)
  - Missing `value`/`inputBindings` not seen with the larger model; a dependent chain (h2 after h1) passed with bindings filled. `inputBindings` kept on purpose.
- [x] Grader keeps chunks that later change a fact the question asks about (LATER CHANGES rule), so the answer can mention amendments
- [x] History: last 2 question/answer pairs in full (3,000 chars each), older messages cut to 200 chars
- [x] Grader status example says "resolved or pending" (stops the misleading `invalid_task_result` label)
- [x] Search rules tell the grader/rewriter not to copy codes or names from already-resolved tasks
- [x] Prompt examples made generic (no names or codes from test documents)
- [~] Reranker drops the right chunk in long tables (parked 8 Nov)
  - Seen on Vantara only: the org chart was ranked #4 (score 0.039) as a whole chunk vs #1 (0.686) when its child pieces were scored. On KHI every answer chunk was kept at #1 with scores above 0.9. Fix designed (rerank child pieces, parent = best piece) but not applied; recheck on the stress test.
- [~] Frontend steps panel (built in the frontend repo)
  - Bugs seen 8 Nov: Final chunks cards mix round, query and rank from different rounds; neighbor chunks are shown with a search rank instead of "nearby"; rerank score only in the Developer tab. Fix prompt given.
- [ ] Update `tests/crag-multi-hop.test.js` mocks (planner objects, JSON rewriter)
- [ ] Add 7-8 Nov work (follow-up search objects, planner rule 7) to `docs/pipeline.js`

## Step 2: Document-Wise RBAC & Access Security (8 hrs)

### Nov 8 (4 hrs)
- [ ] Fix ownership checks on `/api/documents/` and `/api/chat`
- [ ] Prisma migrations for roles (ADMIN, MANAGER, EMPLOYEE) and permissions

### Nov 9 (4 hrs)
- [ ] Inject RBAC permission filters into the pgvector and full-text SQL in `chat.repository.js`

## Step 3: Delta Versioning & Pointer Splicing (10 hrs)

### Nov 10 (5 hrs)
- [ ] Add SHA-256 `contentHash` to `ParentChunk`
- [ ] In-memory chunk diffing service for updated document uploads

### Nov 11 (5 hrs)
- [ ] Surgical DB updates that replace modified chunks
- [ ] Re-stitch `prevParentId` / `nextParentId` links

## Step 4: Enterprise Knowledge Base Corpus & Evals (6 hrs)

### Nov 12 (3 hrs)
- [ ] Ingest the interconnected enterprise dataset (multi-quarter financial filings, v1/v2 policy amendments, SLA tables)

### Nov 13 (3 hrs)
- [ ] Wire up the `goldenDataSet3.js` eval runner for multi-document and multi-hop CRAG accuracy

## Step 5: Web Research Agent & Human-in-the-Loop Interrupts (12 hrs)

### Nov 14 (4 hrs)
- [ ] LangGraph checkpointer and `interrupt()` node when retrieval yields zero graded chunks

### Nov 15 (4 hrs)
- [ ] `POST /api/chat/resume` endpoint
- [ ] `approval_required` SSE event

### Nov 16 (4 hrs)
- [ ] Web Search Agent node (Tavily/SearXNG): fetch, grade, and cite web data after user approval

## Step 6: Model Context Protocol (MCP) Server & Client (8 hrs)

### Nov 17 (4 hrs)
- [ ] MCP Server (`@modelcontextprotocol/sdk`) exposing document search, summary, and page tools with audit logging

### Nov 18 (4 hrs)
- [ ] MCP Client in LangGraph so the agent discovers and runs external MCP tools
