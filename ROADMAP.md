# Roadmap

15 days, 6 stages, ~60 hours (~4 hours/day), starting Wednesday 4 November 2026.

Legend: `[x]` done · `[~]` partly done / done differently · `[ ]` not started

Current order (decided 13 Nov): Step 5 (AI agents and human in the loop) next, then Step 3 (delta versioning, design agreed below), then Step 6. Parked for now: search fixes O-5, O-13, O-19 (Step 4) and the forgot-password fix (Step 2, Phase F).

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
- [~] Planner fixes from the 8 Nov KHI traces
  - Found: rule 7 added "if needed" name hops; "who had to approve" was looked up directly instead of amount -> approval-threshold table (the table only arrived as a neighbor chunk); planning took 27-33 s (2,600-3,400 hidden-thinking tokens).
  - Done 8 Nov: rule 7 reworded (name asked inside the hop, no optional hops) and rule 10 added for "had to / must approve" questions. Verified on the KHI EPC risk question: 4 hops, no extra name hop, 1,095 planning tokens (was 3,408-5,606), correct answer.
  - Not verified: reworded rule 10 (the first wording was ignored), and the Vantara CFO name question after the rule 7 change.
- [~] Validate on `Chunking_Stress_Test_Document.pdf`: skipped 8 Nov by the user's decision (checked several times before); focus moved to RBAC and search at scale
- [ ] Small search fixes before RBAC (no migration, about 1 hour; to do later)
  - Remove the `keyword_debug` and `vector_debug` full-table counts from `searchSingleDocument` and `searchAllUserDocuments` (they run on every query only for the log line).
  - Order the identifier tier's `ROW_NUMBER()` by relevance instead of child ID.
  - Bigger search work (vector index, `documentId` indexes, identifier index, document-level routing) waits until RBAC is in and a large knowledge base is loaded, so it can be measured.
- [ ] Links between documents: decide after the 31-question baseline (parked 10 Nov)
  - Today a jump to another document happens only when the grader asks for the next code and the identifier tier finds it. Stored `references` are followed only inside the same document and only for override words (resolution, amendment, appendix, annex, addendum), a code named in the question, or a contents/guide line.
  - Risks to measure in the baseline: the grader misses a code and the chain stops; a 4-hop chain runs out of rounds (`MAX_CRAG_LOOPS` 3); an old version is used because nothing points from the old document to its newer amendment.
  - Middle path if needed (instead of a separate graph database): a links table in Postgres, `code -> chunk -> type (defines / mentions / amends)`, filled at upload from the codes the chunker already extracts. Uses: (1) newer-version check: when a chunk mentions `FIN-AAM-01`, add the chunk in another document that amends or replaces it (one database lookup, no AI call); (2) jump straight to the chunk that defines a code (e.g. the PO-log row for a PO number). Must respect role access and be cleaned on document delete.
  - Not now: a graph database (Neo4j or similar). The AI would have to extract every relation correctly, many facts depend on dates and rules, it would need sync with re-uploads and roles, and 50 documents are too few to need it. Reconsider only if many questions ask for lists across documents or the links table is not enough.

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
- [x] Add 7-9 Nov work to `docs/pipeline.js` (entries 63-67: follow-up search objects, one-hop planning, planner over-planning, RBAC, email onboarding)

## Step 2: User module, roles & document access (RBAC)

Plan agreed 8 Nov (replaces the earlier ADMIN/MANAGER/EMPLOYEE plan). Order after this step: frontend restructure (header, sidebar modules, multiple chats), then the large knowledge base, then measured search optimization.

### Agreed model
- One library: every uploaded document is in one place. Only the admin uploads.
- Role = a name + a list of documents picked from a dropdown of the library.
- User = name, email, temporary password (set at creation), one or more roles.
- Access rule: a user sees and searches a document only if one of their roles includes it. Several roles = all their documents together. Admin sees all documents.
- No direct document-to-user access: to give one person one document, create a role with that document and assign it.
- Admin = a flag on the user, separate from roles (roles are document lists). Only the admin creates roles and users; normal users can only search and see their own roles and documents.
- Chats: many global chats per user (like Claude), each with its own history, searching all the user's documents. Document chat stays one chat per user per document.
- Current account becomes admin through a one-time database update; old accounts are cleaned up later by hand.

### Phase A: Data
- [x] 1. Plan the tables in words, review together: user name, admin flag, active flag, "must change password" flag; roles; role documents; user roles; conversation type (global or document)
- [x] 2. Migration + Prisma Client generate (only after explicit approval)
- [x] 3. Set the current account as admin in the database
  - Test: account shows admin; every old document still opens

### Phase B: Login and access
- [x] 4. Login returns name, admin flag and "must change password"; public registration turned off; disabled users cannot log in
- [x] 5. Admin guard: admin-only routes reject normal users
- [x] 6. Change password: a user with a temporary password must set a new one first
  - Test: normal user is forbidden on admin routes; temporary password works only until changed
- [x] 7. One access check, "which documents can this user see?" (admin: all; user: documents of all their roles)
  - Test: two roles sharing a document, user with both sees it once

### Phase C: Admin modules
- [x] 8. Role module: create, list, rename, delete; add/remove documents (dropdown uses the library list)
- [x] 9. User module: create (name, email, temporary password, roles), list, edit roles, disable
  - Test: role "Finance" with the KHI document, a user with that role sees only KHI

### Phase D: Apply access everywhere
- [x] 10. Document list shows only the user's documents; upload and delete become admin-only
- [x] 11. Document chat and chunk inspector use the access check ("not found" without access)
- [x] 12. Global search filters to the user's documents; remove the "newest file per filename" rule in `searchAllUserDocuments`
  - Test: the Finance user asks a Vantara question; the answer must not use Vantara

### Phase E: Chats
- [x] 13. Global chats: new, list, rename, delete, each with its own history
- [x] 14. Document chat stays one per user per document, as now
  - Test: two global chats keep separate histories; document chat unchanged

### Phase F: Check and tidy
- [x] 15. Full check with two test users, different roles, admin vs user vs disabled user
  - Tested by the user 9 Nov: roles and access, admin knowledge base (after the `req.user` fix), asking about a document outside the user's roles.
  - Forgot-password returned the reset code in its response until email existed (no attempt limit on the code).
- [x] Email service (9 Nov): new users and admin password resets get an email with the platform link and temporary password (`emailSent` in the response); forgot-password emails the code
  - Still open: forgot-password response still includes `otp` (leaks the code, 500 for unknown emails); `resetPassword` should lowercase the email; no attempt limit on the code. Not yet tested end to end.
- [x] 16. Update `AGENTS.md`, `ROADMAP.md` and the frontend notes (9 Nov; frontend contract in `docs/frontend-rbac-prompt.md`)

### What happens on change
- A document removed from a role: users lose it on their next question; old chat answers that cited it stay in history.
- A document deleted: it disappears from every role.
- A role deleted: users lose its documents; their chats stay.
- The frontend admin pages need the new endpoints from Phases B, C and E; the UI shell (header, sidebar) can be built alongside Phase B.

## Step 3: Delta Versioning & Pointer Splicing (10 hrs)

Postponed 13 Nov until after Step 5.

### Design agreed 13 Nov
- Why: hashes are made after AI extraction, so this saves almost no cost or time (extraction is about 80% of the work; embedding is local). Built for learning and for two real gains: old chat traces keep valid chunk IDs, and the detail page can show what changed between versions.
- Replace endpoint (e.g. `PUT /api/documents/:id`): a re-upload keeps the same document ID, roles and chats. Today a re-upload creates a new document.
- Same hash = same chunk. Hash the normalized `text` plus its section heading path, not `searchText` (it starts with the filename, so a renamed file would change every hash).
- Removed chunks are kept, not deleted: excluded from search and neighbor expansion, shown on the detail page.
- Versions instead of a plain flag: `Document.version` (+1 on each replace); `addedInVersion` and `removedInVersion` on parent and child chunks (search reads `ChildChunk` directly, so children need it too). Search uses only chunks with no `removedInVersion`.
- Duplicates: the same text twice gives the same hash; match by count (two before, one now = one removed).
- Links: recompute `prevParentId`/`nextParentId` for every active chunk (kept chunks can get new neighbours); removed chunks keep their old links for display.
- Later, for a real saving: hash each PDF page before extraction and reuse the earlier extracted text of unchanged pages (skips the AI call for those pages).

### Build order
1. Migration plan in words (exact new columns), approved before writing
2. Migration + Prisma Client generate (only after explicit approval)
3. Replace endpoint
4. Diff service: old vs new chunks by hash -> keep / add / remove
5. Save only the changes in one transaction and re-stitch prev/next links
6. Search and neighbor expansion skip removed chunks; detail page shows versions
7. Test: re-upload the same file (expect 0 changes; AI extraction can vary, so check normalization), then a file with one edited page (only its chunks change)

### Nov 10 (5 hrs)
- [ ] Add SHA-256 `contentHash` to `ParentChunk`
- [ ] In-memory chunk diffing service for updated document uploads

### Nov 11 (5 hrs)
- [ ] Surgical DB updates that replace modified chunks
- [ ] Re-stitch `prevParentId` / `nextParentId` links

## Step 4: Enterprise Knowledge Base Corpus & Evals (6 hrs)

### Before the knowledge base (9 Nov)
- [~] Ingestion fixes ported from the ISGEC project (unit-tested, not yet verified on a real upload)
  - 429 retry for every extraction call; table repair on every page; contents/appendix problems become warnings instead of failing the upload; second appendix on the same page gets its own section; "Row" label for a blank top-left cell; long text cut at a line or sentence end; long table rows split into groups of whole fields; whole codes (`INC-2025-014`, `PO-10234`) and plural references ("Appendices B to D") in `references`. Chunker version `ai-corrected-markdown-v4`.
  - Next: pilot upload of 5 knowledge-base documents, compare stored chunks with the source, then the rest.
- [~] Pilot of 5 knowledge-base documents written 9 Nov (`eval-docs/kb/`: `FACT-SHEET.md`, `ANSWER-KEY.md` with 7 questions, `source/*.html`, `pdf/*.pdf`); extraction switched to Qwen via AI Router. Uploaded 9 Nov (about 7 minutes for 5 documents) and compared with the source: 395 checks, every sentence and every table cell stored with the right column label, tables across pages linked, appendices in their own sections; only the company line "CALDERWICK PUMP SYSTEMS LTD" was dropped on 2 of 5 documents. Next: run Q1-Q7.
- [x] Pilot fixes 9 Nov: prompt keeps the company line above the title; company named in body text; paragraphs kept on one page in the PDFs (a sentence split by a page break was stored in two chunks). Pilot re-uploaded and clean.
- [~] Knowledge base of 50 connected synthetic documents (111 pages) for one made-up company in 6 categories (HR 7, Finance 10, Procurement 10, Operations 9, IT 7, Board & Legal 7), built 9 Nov by `eval-docs/kb/build/`; `ANSWER-KEY.md` has 31 questions with document, page and section per hop. Uploaded 9-10 Nov: 15 documents through OpenRouter Qwen until its free credit ran out (402), the rest through AI Router Qwen; all 50 COMPLETED (372 parents, 402 children; IDs in `eval-docs/kb/UPLOADED.md`). Compared with the sources: every sentence and table cell stored with the right labels except the plant name Ardmoor misread as "Ardmooor" in HR-07 (1 cell) and OPS-02 (5 cells), repeated on retry. Next: assign category roles, run the 31 questions as a baseline before search work. Later about 600 public news articles (MultiHop-RAG) for scale.
- [x] Baseline and first search fixes (10 Nov): 21 selected runs scored (13 correct, 6 partial, 2 access checks passed); 11 fixes applied (planner rules for role holders, premises and rule checks; grader value-kind and current-source rules; verified answer facts in the answer prompt; citations stripped from history; reasoning and token limits on the planner and grader). Verified on Q1, Q3, Q11.
- [x] Second fix round (13 Nov), driven by Q13: a quote with an unknown chunk ID no longer rejects a hop; every entry hop gets a starting query (`hopId`); a fairer quote check (words in order) and exact-quote grader rule; the grader sees every chunk kept in earlier rounds; rule queries use the rule document's words. Q13 now correct with every hop earned (3 rounds, 1m50s, ₹0.57); Q1 in one round (45 s).
- [ ] Next search fixes, in order: identifier ranking (O-5), reranker (O-13), invented chunk-ID tails (O-19); then re-test Q9, Q14, Q16, Q22 with guards Q1, Q3, Q5, Q11, Q13. Details, the Q13 history and open issues O-1 to O-23 are in `eval-docs/kb/ISSUES.md`.

### Nov 12 (3 hrs)
- [ ] Ingest the interconnected enterprise dataset (multi-quarter financial filings, v1/v2 policy amendments, SLA tables)

### Nov 13 (3 hrs)
- [ ] Wire up the `goldenDataSet3.js` eval runner for multi-document and multi-hop CRAG accuracy

## Step 5: Web Research Agent & Human-in-the-Loop Interrupts (12 hrs)

Next step (moved ahead of Step 3 on 13 Nov). Starts 14 Nov. Plan agreed 13 Nov.

### Design agreed 13 Nov
- Goal: learn and build a real AI agent: a web research agent where the model chooses tools (`web_search`, `read_page`) in a loop until it says it is done or hits a step limit (4). CRAG stays a code-driven agentic workflow; the web agent is the AI agent.
- Where it fits: inside CRAG, not in parallel. It runs after the document loop finishes, only for what the documents could not answer, and only after the user approves. It is its own small LangGraph graph (own files, testable alone), added to CRAG as one node.
- When to ask for web search (at most one approval per question):
  - A. The planner marks a hop `source: "web"` (live or outside data: exchange rates, today's prices, news, public facts about other companies, laws). Example: "cost of project P11 in INR" -> h1 documents (P11 cost in USD), h2 web (live USD->INR rate).
  - B. A document hop is still unresolved after the document loop.
  - Never ask for greetings, summaries, page requests, or company-private facts (who approved a PO, internal budgets): the planner marks those `"documents"` only.
- No calculator tool: the generate node does conversions and shows the working (value x rate, rate source and date, result).
- Web search: Tavily, called with plain `fetch` (no new package). Key in `.env` as `TAVILY_API_KEY`.
- Checkpointer: LangGraph Postgres checkpointer (`@langchain/langgraph-checkpoint-postgres`), tables in a separate Postgres schema `langgraph` so Prisma does not see them as drift. Creating the tables needs approval.
- Not now: supervisor / multi-agent (possible later; Step 6 MCP client is the natural place for a general tool-choosing agent). What can be said after this step: "I built a tool-calling web research agent, gated by human approval, inside an agentic RAG workflow." Do not call it multi-agent.

### Phase 1: Web agent alone (Nov 14, about half a day)
- [ ] 1. Tavily account and `TAVILY_API_KEY` in `.env` (user)
- [ ] 2. Tools in `src/agents/web/web.tools.js`: `web_search(query)` (Tavily search, top 5: title, URL, text) and `read_page(url)` (Tavily extract), each with a JSON tool definition like `searchToolDefinition` in `ai.service.js`
- [ ] 3. Plain agent loop in `src/agents/web/web.agent.js` (no LangGraph): call the model with tools; run requested tools and add results; stop when the model answers or after 4 steps; return `{ answer, sources }`
- [ ] 4. Test alone with a script piped into `node` (no file in the project): "USD to INR rate today" (one search, answer with source), "latest RBI repo rate" (may read a page), a vague task (stops at 4 steps). Also checks that the `agent` model supports tool calling; if not, pick another model for this agent only
- [ ] 5. Rebuild as a small LangGraph graph: nodes `agent` and `tools`, edge "tool calls -> tools, else end"

### Phase 2: Pause and resume, human in the loop (Nov 15, about a day)
- [ ] 6. Install `@langchain/langgraph-checkpoint-postgres`; `src/config/checkpointer.js`; tables in schema `langgraph` (approval before creating them)
- [ ] 7. Compile CRAG with the checkpointer; each question gets a new `threadId` passed as `{ configurable: { thread_id } }`
- [ ] 8. Tiny `ask_approval` node that only calls `interrupt({ question, missingHops })` (on resume LangGraph re-runs the node from its first line)
- [ ] 9. `chat.service.js`: on interrupt, send `approval_required` SSE (`threadId`, question), save a "waiting for approval" assistant message, close the stream
- [ ] 10. `POST /api/chat/resume` with `{ conversationId, threadId, approved }`: check the user owns the conversation and the waiting message, continue with `new Command({ resume: { approved } })`, stream and save the answer as usual
  - Test with a temporary "always ask" rule: pause -> Allow/Skip -> resume; restart the server while paused and resume (proves the checkpointer)

### Phase 3: Connect to CRAG (Nov 16, about a day)
- [ ] 11. Planner: `source: "documents" | "web"` per hop, prompt rule with a generic example; the document loop skips `"web"` hops
- [ ] 12. Routing after the document loop: missing hops or `"web"` hops -> `ask_approval`, else `generate`
- [ ] 13. `web_agent` node: on Allow, runs the Phase 1 agent with the missing hop texts; results and URLs stored as `webFacts` in state
- [ ] 14. `generate`: WEB FACTS section with URL and date; each fact labelled document or web; conversions show the working

### Phase 4: UI, tests and docs (Nov 17, about half a day)
- [ ] 15. Events `agent_start`, `agent_step` (each tool call), `agent_finish`, `approval_required`; update `docs/frontend-rbac-prompt.md` for agent cards and Allow/Skip buttons
- [ ] 16. End-to-end tests: P11-in-INR style question (one approval, Allow, correct converted answer with both sources); a question the documents cannot answer (asks); Skip (answers from documents and says what is missing); a private fact (never asks); guards Q1 and Q13 unchanged
- [ ] 17. Update `AGENTS.md`, `ROADMAP.md`, and add a `docs/pipeline.js` entry

## Step 6: Model Context Protocol (MCP) Server & Client (8 hrs)

### Nov 17 (4 hrs)
- [ ] MCP Server (`@modelcontextprotocol/sdk`) exposing document search, summary, and page tools with audit logging

### Nov 18 (4 hrs)
- [ ] MCP Client in LangGraph so the agent discovers and runs external MCP tools
