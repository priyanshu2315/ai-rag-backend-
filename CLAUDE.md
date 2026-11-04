@AGENTS.md

# Session handoff — reviewed 4 November 2026

Read the shared instructions imported above before acting. They contain the current architecture, approval rule, migration history, inspection APIs, and known gaps. A request to inspect or explain authorizes reading only; edit files only when the user explicitly requests the change. The user often prefers step-by-step guidance in chat and applies code changes manually.

Latest work (4 November): hybrid search now uses structured planner queries `{ text, keywords, identifiers, entities }`, converted by `buildSearchTiers()` into identifier (`ILIKE`, 2.5x), phrase (`<->`, 1.5x), keyword (planner keywords, 1.0x), and vector (1.0x) tiers merged with weighted RRF (k=10). `retrieveNode` runs queries in parallel and passes only the query text to embeddings, Cohere, events, and `allQueries`. Planned next: live per-tier tracking (`matchedBy`, per-tier ranks, before/after rerank positions), a final score `ORDER BY` on search candidates, and tiers for follow-up/rewrite queries.

AI routing is set in code (`DEFAULT_TASK_PROVIDERS` in `src/config/ai.js`); env provider overrides are no longer read, but `rag.config.js` still picks its limit profile from env. Ingestion was reworked after 5 October (AI-model extraction with a contents outline, `simple-chunking.service.js`); verify its details in source before describing them.

Redis progress history is disabled: upload events are live only, while saved chunks stay inspectable through REST. Chat trace events (non-token) are saved in assistant message `metadata.steps`.

The 5 October stress-test defects (heading hierarchy, interrupted tables, section 5A -> 5 link, table rows without column labels) were found with the old chunker and have not been re-tested. Kettleby's correct city-proper population for 31 December 2023 is 163,482; 158,744 is the earlier census. Keep document identity generic; do not require company names from users.

Never print `.env` values or API keys in command output; filter by key name, not by value.

`docs/architecture.html`, `docs/pipeline.js`, and `docs/chat-pipeline.md` predate the November search changes. Treat them as historical orientation and verify runtime details against source code.
