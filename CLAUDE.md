@AGENTS.md

# Session handoff — reviewed 8 November 2026

Read the shared instructions imported above before acting. They contain the current architecture, approval rule, migration history, inspection APIs, and known gaps. A request to inspect or explain authorizes reading only; edit files only when the user explicitly requests the change. The user prefers step-by-step guidance in chat and applies code changes manually, then re-tests the same questions and asks for the saved trace to be explained. Keep prompt examples generic: never copy names, codes or answers from a test document into prompts or code.

Latest work (7-8 November): the planner, the grader's `next_query` and the rewriter all return `{ text, keywords, identifiers, entities }`, so follow-up rounds run identifier and phrase search (`toSearchQuery()`, `nextQuery` state, shared `SEARCH_OBJECT_RULES`). Planner rule 7 ("one hop = one lookup") makes dependent chains explicit. Verified on Vantara (3-hop risk-owner chain) and on `KHI_Integrated_Annual_Report_FY2025.pdf` (document ID `d0d19110-07fe-4ff9-9a77-21193e13d447`, 3 chain questions, all correct). The reranker change (score child pieces, parent = best piece) helped on Vantara but was not needed on KHI, so it is parked and not applied.

8-9 November: planner rule 7 reworded and rule 10 added (partly verified, see ROADMAP); the stress test was skipped by the user's decision; ROADMAP Step 2 (users, roles, document access, admin modules, multiple global chats) is built and tested by the user (see AGENTS.md "Users, roles and document access"). 9 November: email service added (welcome and admin-reset emails with temporary password, forgot-password code by email); the forgot-password response still contains `otp` (see AGENTS.md).

10-13 November: search work on the Calderwick knowledge base (50 synthetic documents, `eval-docs/kb/`): a 21-run baseline from `ANSWER-KEY.md`, then two fix rounds (F1-F11 on 10 November, F12-F17 on 13 November) in the planner and grader prompts, `hop-evidence.service.js`, the answer prompt and chat history. Q13 (approvers for a stated order) is now correct with every hop earned and Q1 resolves in one round. `eval-docs/kb/ISSUES.md` holds the fixes, the Q13 history, the baseline register and open issues O-1 to O-23; AGENTS.md describes the resulting pipeline. Test changes on `http://localhost:5173` with the local backend (the Vercel frontend calls the deployed backend, which runs only pushed code). Trace readers must not create files in the project folder: nodemon restarts and a finished answer is lost because it is saved only after streaming. Pipe read-only scripts into `node --input-type=module` instead.

Next task: search fixes in the agreed order, identifier ranking (O-5), the reranker (O-13), invented chunk-ID tails (O-19), then a re-test of Q9, Q14, Q16 and Q22 with guards. The frontend restructure uses `docs/frontend-rbac-prompt.md`. Keep `docs/frontend-rbac-prompt.md` updated after every backend API change. `ROADMAP.md` tracks status.

To explain how a question was answered, read the assistant message's `metadata.steps` from the database (read-only) and walk through plan, per-round search/rerank/expansion, grading, decision, and generation context. For each fact, follow the grader's evidence chunk IDs back through `retrieval_candidates`, `rerank_result` and `neighbor_expansion` to say whether it was earned (asked for, searched, kept with a clear score), fragile (kept at the edge or with a score below about 0.05), or luck (no hop or query aimed at it). Vantara conversations use document ID `2b97bac0-33a6-4d7a-9cfd-9f723151d870`; KHI uses `d0d19110-07fe-4ff9-9a77-21193e13d447`. The user's frontend runs at `http://localhost:5173` and can be read through Claude in Chrome when it is connected.

The user did not write the synthetic test documents and does not know their content. When proposing test questions, give the expected answer with the page and section for every hop.

AI routing is set in code (`DEFAULT_TASK_PROVIDERS` in `src/config/ai.js`); env provider overrides are no longer read, but `rag.config.js` still picks its limit profile from env. Ingestion was reworked after 5 October (AI-model extraction with a contents outline, `simple-chunking.service.js`); verify its details in source before describing them.

Redis progress history is disabled: upload events are live only, while saved chunks stay inspectable through REST. Chat trace events (non-token) are saved in assistant message `metadata.steps`.

The 5 October stress-test defects (heading hierarchy, interrupted tables, section 5A -> 5 link, table rows without column labels) were found with the old chunker and have not been re-tested. Kettleby's correct city-proper population for 31 December 2023 is 163,482; 158,744 is the earlier census. Keep document identity generic; do not require company names from users.

Never print `.env` values or API keys in command output; filter by key name, not by value.

`docs/architecture.html` and `docs/chat-pipeline.md` predate the November search changes. Treat them as historical orientation and verify runtime details against source code. `docs/pipeline.js` (served by `GET /api/pipeline`) is updated through 13 November (entries 59-70, 58 entries in total); add a new entry when a notable problem is solved.
