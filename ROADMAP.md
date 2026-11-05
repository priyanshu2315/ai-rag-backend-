# Roadmap

15 days, 6 stages, ~60 hours (~4 hours/day), starting Wednesday 4 November 2026.

Legend: `[x]` done · `[~]` partly done / done differently · `[ ]` not started

## Step 1: Search Optimization & structured-context-v4 Part 2 (16 hrs)

### Nov 4 (4 hrs)
- [x] Replace `plainto_tsquery` (keyword search optimization)
  - Done with custom `buildSearchTiers()`: identifier (`ILIKE`), phrase, and keyword tiers plus weighted RRF. `websearch_to_tsquery` was not used because it ANDs words and splits IDs.
- [ ] Fix duplicate question injection in history
- [ ] Add token-budget trimming

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
- [~] Upgrade decompose for sequential two-stage dependent lookups
  - Exists today: hop plan with `dependsOn` plus `next_hop` follow-up searches. Follow-up queries are plain strings without tiers.
- [ ] Validate on `Chunking_Stress_Test_Document.pdf`

### Extra work done in Step 1 (not in the original plan)
- [x] Planner returns `{ text, keywords, identifiers, entities }` per query
- [x] Per-tier `ORDER BY` before `LIMIT`, empty-tsquery crash fix, `searchAllUserDocuments` parity
- [x] Live search tracking: `matchedBy`, per-tier ranks, `retrievalRank`/`rerankRank`/`rerankApplied`/`searchInputs`, final `ORDER BY total_score`
- [x] BigInt serialization fix (`::int` on counts)
- [ ] Frontend steps panel redesign (prompt given, frontend repo)

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
