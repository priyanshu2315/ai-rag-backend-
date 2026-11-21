# Roadmap

15 days, 6 stages, ~60 hours (~4 hours/day), starting Wednesday 4 November 2026.

Legend: `[x]` done · `[~]` partly done / done differently · `[ ]` not started · `[-]` inactive (kept for later, not planned now)

Current order (updated 21 Nov): Step 5 (web agent and human in the loop) done 15 Nov, open tests included; Step 6 (MCP) done 17 Nov (server A1, A5, A6; client B1, B2; docs updated); Step 3 (delta versioning: replace a document with full extraction) done and verified 18-19 Nov, item 8 skipped; next finish (README, demo video). Inactive in Step 6: A2, A3, A4, A7, B3, B4, B5. Dropped 16 Nov: Step 5B (tasks and multi-agent; it would not improve search). Later: Step 5C (automation when a document is uploaded) and Step 3 item 8 (send only changed sections to the AI). Parked for now: search fixes O-5, O-13, O-19 (Step 4) and the forgot-password fix (Step 2, Phase F).

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

Postponed 13 Nov until after Step 5. Started 18 Nov. Items 1-7 coded 18-19 Nov (replace works with full AI extraction) and verified end to end 19 Nov on a 3-version test document (item 9); item 8 (send only changed sections to the AI) skipped for now; docs updated 21 Nov (item 10). Plain-language walkthrough: `docs/delta-versioning-guide.md`.

### Design agreed 13 Nov (partly superseded by "Approach agreed 18 Nov" below: change detection now runs before AI extraction)

- Why: hashes are made after AI extraction, so this saves almost no cost or time (extraction is about 80% of the work; embedding is local). Built for learning and for two real gains: old chat traces keep valid chunk IDs, and the detail page can show what changed between versions.
- Replace endpoint (e.g. `PUT /api/documents/:id`): a re-upload keeps the same document ID, roles and chats. Today a re-upload creates a new document.
- Same hash = same chunk. Hash the normalized `text` plus its section heading path, not `searchText` (it starts with the filename, so a renamed file would change every hash).
- Removed chunks are kept, not deleted: excluded from search and neighbor expansion, shown on the detail page.
- Versions instead of a plain flag: `Document.version` (+1 on each replace); `addedInVersion` and `removedInVersion` on parent and child chunks (search reads `ChildChunk` directly, so children need it too). Search uses only chunks with no `removedInVersion`.
- Duplicates: the same text twice gives the same hash; match by count (two before, one now = one removed).
- Links: recompute `prevParentId`/`nextParentId` for every active chunk (kept chunks can get new neighbours); removed chunks keep their old links for display.
- Later, for a real saving: hash each PDF page before extraction and reuse the earlier extracted text of unchanged pages (skips the AI call for those pages).

### Reflow problem and paragraph hashes (discussed 17 Nov, to deep-dive again)

- Problem: one paragraph inserted on page 1 pushes the last paragraph of every page onto the next page, so every page hash changes and the whole document looks new. Pages are fixed containers; the same cascade happens with fixed-size chunks.
- The current chunker has the same cascade: it starts a new parent at every page change (`simple-chunking.service.js`, `newPage` check) and packs pieces by token budget, so a moved paragraph changes every later parent's hash.
- Fix: hash content, not containers.
  - Paragraph hashes: hash each piece (paragraph, table row, list item). Diff the old and new ordered lists (like `git diff`) to get keep / add / remove. Example: old `[A B C][D E F][G H]`, new `[A X B][C D E][F G H]`: page hashes say 3 of 3 changed, paragraph hashes say only X is new.
  - Cut parents at headings, not at page breaks (page number stays as metadata). An insert then changes only chunks in its own section; the next heading stops the cascade.
- Paragraph -> chunk link: when the chunker builds a chunk from pieces, save its ordered `paragraphHashes` (in `metadata`, no migration; or a `ChunkParagraph { chunkId, order, hash }` table if it must be queried) and `contentHash = hash(paragraphHashes)`.
- Re-upload flow: (1) paragraph diff finds the new or removed paragraphs; (2) find the old chunks that held them or their neighbours; (3) re-chunk only that section; (4) compare each new chunk's `contentHash` with the old chunks: match = keep (same ID, no new embedding), no match = add, old chunk without a match = removed (`removedInVersion`). Example: old section `#7 [A B C]`, `#8 [D E]`; new `[A X B]`, `[C D E]`: both replaced (C moved), every other section kept.
- Extraction cost: page hashes cannot survive a reflow; they only save the AI call for edits that do not move text (a number, a typo). Simple option (preferred): re-extract everything and let the paragraph diff keep DB changes small. Advanced option: hash paragraphs from the free PDF text layer, send only pages with new paragraphs to the AI and rebuild the rest from old extracted paragraphs (hard part: matching text-layer paragraphs to the AI's Markdown).
- Open questions for the deep-dive: does AI extraction give the same text on a re-run (normalization before hashing)? How to split a paragraph that the old version split across a page break? Does cutting at headings change search quality (bigger parents for long sections)?

### Approach agreed 18 Nov (replaces "hash after extraction" from 13 Nov)

- Goal: find what changed BEFORE any AI call, so a re-upload of a frequently changing document (10k-document scale) costs AI only for the changed sections.
- Gate 1, file hash: SHA-256 of the PDF bytes; same hash = same file, stop (0 AI calls).
- Gate 2, text-layer diff (free): `pdf-parse` reads the PDF text layer (checked 18 Nov: PRC-02, 3 pages in 145 ms). The text layer has no paragraph marks (one line per printed line, wrapped by width), so join all pages into one stream (line wraps and page breaks removed), then split into units: sentences (end at `.`, `?`, `!`; a sentence is not a line), table rows (one line with tabs), and other short lines without a full stop (each its own unit). `pdf-parse` does not know headings; no heading guessing is needed (sections come from the old chunks, below). Normalize (spaces, case for matching) and drop running headers/footers and page numbers (a line that repeats on most pages), otherwise one added page shifts every page and looks like many changes. Hash each unit. Diff old vs new unit lists like `git diff` (`diff` npm package, longest common sequence) -> added/removed units with their new page. Unit hashes ignore line wrap and page breaks, so a reflow does not look like a change.
- Unit storage (one table, current version only, overwritten on each replace): `documentId`, `position` (order; the diff needs it), `kind` (sentence/row/line), `text` (so the old PDF never has to be downloaded again; also for debugging), `hash`, `page`, `parentChunkId`. About 500 units per document, 5 million rows at 10k documents; index on `documentId`.
- Unit -> chunk link, made once at upload (like a book index): right after chunking, find for each unit the parent chunk that holds it and save `parentChunkId`. Matching: normalize both (lowercase, letters and digits only), candidates = old chunks on the unit's page (2-4), pick the chunk containing at least about 90% of the unit's words in order (reuse `isQuoteInDocText()` from `hop-evidence.service.js`). The chunk text is the AI's Markdown (`- **Orders above 50,000** need...`), so an exact match would miss. No match (AI dropped a line): leave `parentChunkId` null; at replace time use the next unchanged unit before or after the change, else the whole page's sections.
- Old unit list: saved at upload from now on. Documents uploaded before this: built lazily from the old PDF in Supabase Storage (`Document.fileUrl`) on their first replace, then linked to chunks by the same matching; no `fileUrl` -> full extraction once.
- Find the section of a change (free, database read): take the unchanged unit just before the change -> its `parentChunkId` -> that chunk's `heading_path`; the last entry is the smallest section holding the change (a list is not a heading; list items belong to the heading above them). Example: Title > 4. Approvals > 4.2 Limits > list item changed -> replace section "4.2 Limits" with its whole list. Change at the edge of two sections -> replace both.
- Gate 3, AI only for the changed section: send the new pages that hold the section's units (not a fixed +-1 page; a long section can span 5 pages), pass the section's known `heading_path` in the prompt. Parse the AI Markdown into headings (remark, as the chunker does), find the heading whose TEXT matches the section's last path entry (not its level; the AI may write `##` or `###` when it sees only a few pages), cut from it to the next heading of the same or higher level. Re-chunk that piece with the known parent path, so new chunks get the full `heading_path`. Heading renamed (no text match) -> widen to the parent section; never guess. A new section -> send the pages between the known neighbouring sections. Unchanged sections are not re-extracted and keep their chunks.
- Chunk diff after re-chunking: two hashes per chunk. `contentHash` (chunk `text` only) decides keep/add/remove; `contextHash` (full `searchText`: title + section path + text) decides re-embed. Same content = same ID; new content = new row + embedding; old chunk without a match = `removedInVersion` (kept, not deleted, so old chat traces and a version view still work). Page moved only = update page metadata (`searchText` has no page number). Title or heading renamed = same IDs, re-embed locally (no AI).
- Chunker prerequisite: today a parent closes at a section change, at a page change (`newPage`, `simple-chunking.service.js` about line 788) or at 1,024 tokens. Drop the page-change cut so an insert only changes its own section; page stays in metadata (a chunk may span pages). Old documents keep their v4 chunks and search keeps working; each moves to v5 on its first replace (that first replace changes every chunk once).
- Fallbacks to full extraction: no text layer (scanned), more than about 40% of units changed, missing old PDF.
- Images and scans (later): embedded images in a text PDF -> hash image bytes (usually identical when unchanged). Fully scanned PDFs: rescans give different bytes, so use a perceptual hash per page, local OCR (tesseract.js) plus fuzzy diff for unsure pages; start with full extraction for scans.

### Worked example (v1 -> v2, one line changed)

- v1 upload: 3 pages; pdf-parse units u1-u9; full AI extraction; chunks C1 (4.1 Requests, p1), C2 (4.2 Limits, p2), C3 (4.3 Emergencies, p3); links u1-u4 -> C1, u5-u7 -> C2, u8-u9 -> C3; embed; version 1.
- v2 re-upload ("Orders above 100,000 need the CFO" -> "75,000"): Gate 1 hash differs -> Gate 2 diff: u7 removed, 1 new unit on page 2 -> unit before (u6) -> C2 -> section 4.2 Limits -> send page 2 only -> cut "### 4.2 Limits" to the next heading -> re-chunk -> C1 keep, C2 `removedInVersion = 2`, C2' insert + embed, C3 keep -> one transaction: overwrite units, links C1 -> C2' -> C3, `fileHash`, version 2. AI: 1 of 3 pages; old chats still valid.

### Good to know before coding (agreed 18 Nov)

- AI output is not exactly repeatable: when a section is re-extracted, its unchanged lines may come back slightly different (spacing, bold), so 2 chunks change instead of 1. Accepted: costs a little embedding, never a wrong answer.
- Search during a replace: old chunks stay active until the final transaction commits; the switch is all at once.
- Old documents keep v4 chunks and search keeps working; no mass re-upload needed. Each moves to v5 on its first replace (every chunk changes once). Optional later: re-chunk from stored `ParentChunk.text` without AI (verify the stored text can rebuild the Markdown first).
- Cutting at headings makes some parents bigger (up to 1,024 tokens); the reranker scores whole parents (Vantara burying problem), so test search quality on a few documents before trusting v5.

### Decisions for later steps

- Summary after a replace: regenerate only when more than about 10% of units changed (proposed), else keep the old summary.
- Two replaces of one document at once: answer 409 while its status is `PROCESSING`.
- Removed chunks pile up per version: fine for now; later a cleanup (for example keep the last 3 versions).
- PDF only; Word/Excel need their own text reader (out of scope).

### Build plan (step by step; the user applies code from chat guidance)

1. [x] Unit extraction + diff as a read-only script (no DB): `extractUnits(pdfBuffer)` (join lines, split sentences/rows, drop repeated headers/footers and page numbers, hash) and `diffUnits(old, new)`. Run it piped into `node --input-type=module` or from the scratchpad, not as a file in the project folder (nodemon restarts). Test: edit one sentence in a Calderwick source (`eval-docs/kb/build/`), regenerate the PDF, check the diff finds only that sentence; then insert a paragraph on page 1 and check later pages are not reported.
   - Done 18 Nov: `src/services/document-units.service.js` (`diff@9.0.0` added). Units: tab line = `row`; a wide line without an end mark is wrapped (joined, also across pages); other lines end a block that is split into sentences; "1." merged with its heading; hyphen line ends joined without a space. Furniture: a line in the top or bottom 2 lines of at least half the pages (min 3), digits masked so "1/3" and "2/3" match. `diffUnits` returns `kept`, `added`, `removed` and `moved` (same hash removed and added: table rows that crossed a repeated table header). Tested on scratch copies of PRC-02 and HR-01 (corpus PDFs untouched): same file 0 changes; one sentence edited 1 removed + 1 added; paragraph inserted 2 added, 0 removed, 3 moved; with browser header/footer the same, no header/footer units.
2. [~] Chunker v5: remove the page-change cut, add `contentHash` and `contextHash` to chunk metadata, bump `chunker_version`. Test: re-upload 3-5 documents, re-run guards Q1, Q3, Q11, Q13.
   - Applied 18 Nov (`ai-corrected-markdown-v5`): no `newPage` cut; parent and child `metadata.content_hash` (`text`) and `context_hash` (`searchText`), SHA-256 of whitespace-collapsed text, 16 hex, case kept; a heading reprinted at the top of a page for the section already open is dropped (otherwise it appears twice in one parent and the hash depends on the page break). Two tests in `tests/ai-corrected-ingestion.test.js` updated to the v5 behaviour (one parent across the page break, `source_pages` [1, 2]). Chunker tests 42 pass; the 4 failures existed before (2 extraction-model tests; 2 in `table-continuation-retrieval.test.js` call `getParentNeighbors()` with the pre-RBAC arguments). 19 Nov: 6 real uploads are v5 with both hashes, and the v3 test kept section 3 across a page break. Guards Q1, Q3, Q11, Q13 not re-run (the knowledge base is still on v4 chunks until each document is replaced).
3. [x] Migration plan in words, approved before writing, then migration + `prisma generate` (only after explicit approval). Draft: `Document.fileHash`, `version` (default 1), `updatedAt`; table `DocumentUnit` (`documentId`, `position`, `kind`, `text`, `hash`, `page`, `parentChunkId`, index on `documentId`); parent and child `contentHash`, `contextHash`, `addedInVersion` (default 1), `removedInVersion` (nullable); indexes on `(documentId, removedInVersion)`.
   - Applied 18 Nov: `20261118103110_delta_versioning` (Document `fileHash`, `version`, `updatedAt`; parent and child `addedInVersion`, `removedInVersion`; `DocumentUnit` with unique `(documentId, position)`, cascade on document delete, `SetNull` on chunk) and `20261118103600_chunk_version_indexes` (`(documentId, removedInVersion)` on both chunk tables). Chunk hashes stay in `metadata` (no columns): the replace diff compares one document's chunks in memory. Existing data: 70 documents at version 1, every chunk active.
4. [x] Upload saves the file hash, the unit list and each unit's `parentChunkId` link (worker, after chunking).
   - Code done 18 Nov, not yet tested on an upload. The worker downloads once (`aiService.downloadDocument()`, `extractDocument({ buffer })`), saves `fileHash` with `status: COMPLETED`, and `buildUnitIndex()` runs `extractUnits` + `linkUnitsToChunks` for PDFs (a failure only logs `units_failed`); `saveDocumentChunks(documentId, parents, units)` saves units in the chunk transaction. Matching: letters and digits only (codes split at hyphens), candidates = chunks whose `source_pages` hold the unit's page, current chunk first; 3 words or fewer must all match, longer units 90% in order. Read-only check against the stored chunks of all 50 knowledge-base documents: 3,395 of 3,401 units linked (99.8%); the 6 misses are the AI misread "Ardmooor".
5. [x] Replace endpoint (`PUT /api/documents/:id`, admin): same document ID, roles and chats, `version + 1`; Gate 1 and Gate 2 (no changes -> stop). Lazy old units from Storage.
   - Code done 19 Nov, not yet tested. `replaceDocument()` in `document.service.js`: PDF only, `status` must be `COMPLETED`, one replace per document (BullMQ job ID `replace-<docId>`, freed on complete or fail); Gate 1 `fileHash`, Gate 2 `diffUnits` (only "moved" = no change; skipped for scanned PDFs or a missing old file); the new PDF goes to the uploader's folder (delete checks it); `Document` is not changed here. `storagePathOf()` is shared with delete. `Document.status` stays `COMPLETED` during a replace so search keeps the old chunks.
6. [x] Chunk diff with full extraction first (correct end to end before saving cost): keep/add/remove, re-embed on `contextHash` change, page metadata updates, re-stitch `prevParentId`/`nextParentId`, all in one transaction.
   - Code done 19 Nov, not yet tested on a real replace. `src/services/document-replace.service.js`: `planChunkChanges()` (match by content hash, one old chunk per new chunk; v4 chunks hashed from their text; children matched inside kept parents; links re-pointed to final IDs) and `runReplaceJob()` (full extraction, v5 chunks, embed only added children and kept children whose `searchText` changed, units, then `saveReplacedVersion()` in one transaction with a version check, then the old PDF is deleted; on failure the new PDF is deleted and nothing changes). The summary is kept as it was. Checked with the real chunker: same text 5/5 kept; one value changed 4 kept, 1 added, 1 removed, 0 re-embedded; title renamed 4 kept, 1 added, 1 removed, 6 children re-embedded.
7. [x] Search, neighbor expansion, page fetch, MCP tools and chunk inspector skip chunks with `removedInVersion`.
   - Code done 19 Nov: 19 filters in `chat.repository.js` (both search functions, every tier, chapter, sibling, section-lead, table and reference expansion, `getChunksByPage`, `getDocumentText`) and the inspector (`getAllParentChunks`, `getChildChunksByParentId`). `getParentChunkById` still opens a removed chunk on purpose (old chat answers link to it). Read-only check on KHI: search, page fetch and inspector return as before.
8. [-] Gate 3: partial extraction of changed sections only, reuse stored Markdown for the rest.
   - Skipped 19 Nov by the user's decision (the hardest part; replace already works with full extraction). Kept for later.
9. [x] Tests: same file (0 AI calls), one sentence edited, paragraph inserted (reflow), title changed, scanned PDF (falls back), missing old PDF (falls back).
   - Test documents 19 Nov: `delta-version-docs/` (one 2-page policy in 3 versions, expected diffs and chat questions in its README). Run by the user 19 Nov (document `02feb006-e179-4f36-8db6-7bb7dcd8b9ce`, now version 3): v1 again -> `same_file`; v1 -> v2 replaced exactly the 3 changed sections (cover, 3. Approval limits, 7. Records), kept the other 6 parents with their v1 IDs, embedded 3 children, 48 of 48 units linked; v2 -> v3 (new paragraph on page 1 that pushes text onto page 2, renamed heading, changed deadline, removed sentence) replaced exactly the cover and sections 1, 5 and 6 and kept sections 2, 3, 4, 7 and 8 (section 3 now spans pages 1-2 and kept its ID), 49 of 49 units linked. Five other v5 uploads on 19 Nov linked 1,030 of 1,044 units (98.7%). Not yet run: the chat questions in `delta-version-docs/README.md`, a scanned PDF, a missing old file, a title-only change.
   - Added 19 Nov: `GET /api/documents/:docId/changes?version=N` (chunks added and removed in a version, paired per section as changed/added/removed, plus `keptChunks`) for a "What changed" tab; checked on the test document (3 changed, 6 kept).
10. [x] Update `docs/frontend-rbac-prompt.md` (replace endpoint, versions), `docs/architecture.html`, `docs/pipeline.js`, AGENTS.md.
   - 19 Nov: `docs/frontend-rbac-prompt.md` has the replace endpoint, progress events, `version` in the document list and the "What changed" endpoint and screen. 21 Nov: AGENTS.md section "Delta versioning: replace a document", CLAUDE.md handoff, `docs/architecture.html` (Replace -> Replace job -> Version switch row in the Upload panel, `DocumentUnit` in the data store), `docs/pipeline.js` entry 74, `docs/delta-versioning-guide.md`.
11. [ ] Later: image byte hashes, perceptual hash/OCR for scans, optional re-chunk of old documents from stored text (verify the stored text can rebuild the Markdown first).

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

Built and verified 14 Nov (5 runs, all correct; see Phase 4). Open: Skip, restart-while-paused and guard re-tests (task 16).

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

- [x] 1. Tavily account and `TAVILY_API_KEY` in `.env` (user)
- [x] 2. Tools in `src/agents/web/web.tools.js`: `web_search(query)` (Tavily search, top 5: title, URL, text) and `read_page(url)` (Tavily extract), each with a JSON tool definition like `searchToolDefinition` in `ai.service.js`
- [x] 3. Plain agent loop in `src/agents/web/web.agent.js` (no LangGraph): call the model with tools; run requested tools and add results; stop when the model answers or after 4 steps; return `{ answer, sources }`
- [x] 4. Test alone with a script piped into `node` (no file in the project): "USD to INR rate today" (one search, answer with source), "latest RBI repo rate" (may read a page), a vague task (stops at 4 steps). Also checks that the `agent` model supports tool calling; if not, pick another model for this agent only
  - 14 Nov: the `agent` model (airouter `deepseek/deepseek-v4-flash`) supports tool calls, including parallel calls. USD->INR used 2 searches per step, then 2 `read_page` calls, and hit the 4-step limit with a sourced answer; the RBI repo rate finished in 3 steps without `read_page`. Only `{ role, content, tool_calls }` is sent back (the reply's `reasoning` fields are dropped).
- [x] 5. Rebuild as a small LangGraph graph: nodes `agent` and `tools`, edge "tool calls -> tools, else end"
  - `src/agents/web/web.graph.js` (`webAgentGraph`, `runWebAgentGraph`); reuses `MAX_STEPS`, `SYSTEM_PROMPT`, `runToolCall`, `collectSources` exported from `web.agent.js`. `onStep` is passed in `config.configurable`, not state, so state stays saveable for the checkpointer.

### Phase 2: Pause and resume, human in the loop (Nov 15, about a day)

- [x] 6. Install `@langchain/langgraph-checkpoint-postgres`; `src/config/checkpointer.js`; tables in schema `langgraph` (approval before creating them)
  - 14 Nov: version 1.1.2 (1.1.3 was 2 days old). `setupCheckpointer()` created schema `langgraph` with `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` (verified). A function in `config.configurable` (`onEvent`) works with it, and `deleteThread()` removes a run's rows.
- [x] 7. Compile CRAG with the checkpointer; each question gets a new `threadId` passed as `{ configurable: { thread_id } }`
  - 14 Nov: `createCragPipeline({ checkpointer })` (optional, so unit tests run without a database); `finishAnswer()` deletes the run's checkpoints after the answer.
- [x] 8. Tiny `ask_approval` node that only calls `interrupt({ question, missingHops })` (on resume LangGraph re-runs the node from its first line)
  - 14 Nov. Changed design: `interrupt({ question, webHops })` sends only hops marked `source: "web"` (unresolved document hops are not sent to the web; trigger B dropped). `routeToAnswer()` runs when the document loop stops (any `stopReason`) from `grade` and `rewrite`; `webApproval` state (null/true/false) allows one popup per question. The temporary `ALWAYS_ASK_FOR_TEST` switch was removed in Phase 3.
- [x] 9. `chat.service.js`: on interrupt, send `approval_required` SSE (`threadId`, question), save a "waiting for approval" assistant message, close the stream
  - 14 Nov: `getPause()`, `savePause()` (message metadata `status: "awaiting_approval"`, `threadId`, `webHops`, `steps`), `finishAnswer()`.
- [x] 10. `POST /api/chat/resume` with `{ conversationId, threadId, approved }`: check the user owns the conversation and the waiting message, continue with `new Command({ resume: { approved } })`, stream and save the answer as usual
  - 14 Nov: `claimApproval()` (owner, document access, waiting message; claim to `resuming` so a double click answers 409), `resumeAnswer()` replaces the waiting message with the answer and resets it to waiting on error. Frontend contract added to `docs/frontend-rbac-prompt.md`.
  - Pause -> Allow -> resume verified 14 Nov. Not yet run: Skip, and restarting the server while paused (proves the checkpointer).

### Phase 3: Connect to CRAG (Nov 16, about a day)

- [x] 11. Planner: `source: "documents" | "web"` per hop, prompt rule with a generic example; the document loop skips `"web"` hops
  - 14 Nov: planner rule 13 (rules reordered; query-object rule is now 14). `validateHopPlan()` keeps `source` only for web hops. `decompose` splits the plan: `hopPlan` = document hops only (grader, `nextPendingHop`, `isPlanComplete` unchanged), `webHops` = web hops; no starting queries for web hops; a document hop may not depend on a web hop, and a web hop may not depend on another web hop (planning retries otherwise). A web-only plan skips document search.
  - 14 Nov fix: the planner wrote "find the new monthly fee in euros stated in the amendment" (a value the documents do not have; 3 rounds wasted, then the answer used the FY2026 budget rate). Rule 13 now says documents state amounts in their own currency: plan "find the value and its currency" plus a rate hop, which is "web" unless the question names a company rate (budget, contract, internal). Re-test planned the web hop.
- [x] 12. Routing after the document loop: `"web"` hops -> `ask_approval`, else `generate`
  - `needsWebApproval()` = `webApproval === null && webHops.length > 0`; used from `grade`, `rewrite` and `decompose` (web-only plan). Unresolved document hops never go to the web.
- [x] 13. `web_agent` node: on Allow, runs the Phase 1 agent; results and URLs stored as `webFacts` in state
  - 14 Nov: one agent per web hop, all in parallel (`runOneWebAgent()`, `agentId` `web-<hopId>`); each task gets the resolved document values it depends on. One failed agent does not stop the others. `webFacts = { searchedAt, results: [{ hopId, task, answer, sources, stopReason }] }`. `webAgentGraph` compiles with `checkpointer: false` (otherwise it inherits CRAG's checkpointer and parallel agents share one checkpoint slot).
- [x] 14. `generate`: WEB FACTS section with URL and date; each fact labelled document or web; conversions show the working
  - Also: "not found on the web" tasks are named; after Skip the answer says which outside facts were not looked up. `webHops` is in ANSWER COVERAGE.

### Phase 4: UI, tests and docs (Nov 17, about half a day)

- [x] 15. Events `agent_start`, `agent_step` (each tool call), `agent_finish`, `approval_required`; update `docs/frontend-rbac-prompt.md` for agent cards and Allow/Skip buttons
  - Every `agent_*` event carries `agentId` and `hopId`; the doc describes the "● N agents working" indicator, `webFacts`, and "Decide later" as UI-only (no backend action).
- [x] 16. End-to-end tests (all run by the user, 15 Nov): P11-in-INR style question (one approval, Allow, correct converted answer with both sources); a question the documents cannot answer (asks); Skip (answers from documents and says what is missing); a private fact (never asks); guards Q1 and Q13 unchanged
  - Verified 14 Nov (all with Allow, answers correct): PO-10234 in INR (h1 documents USD 64,800, h2 web rate, 1 tool call); Fed policy rate (web-only plan, no document search, 3-4 tool calls); PO-10234 in INR, EUR and GBP (3 parallel agents: `web-h2` done, `web-h3` and `web-h4` hit the 4-step limit but still answered; 14 tool calls); Brennock fee in euros after the rule 13 fix (USD 19,800, web hop planned).
  - Not yet run: Skip, restart while paused, a private-fact question (must not ask), guards Q1 and Q13.
  - Seen: rate pages can show an older snapshot (an Xe page dated 28 Oct 2026); the answer lists several providers' rates.
- [x] 17. Update `AGENTS.md`, `ROADMAP.md`, and add a `docs/pipeline.js` entry

## Step 5B: Agents section for tasks, multi-agent (DROPPED 16 Nov)

Added 14 Nov. Dropped 16 Nov by the user's decision: the project is about search, and tasks or a multi-agent layer would add cost and latency without better answers (the planner already runs independent hops in parallel in round 1). Kept below for reference only. Lets a user give a task (question plus action), not only a question. Separate APIs and frontend page; the RAG chat stays as it is.

### Design agreed 14 Nov

- Supervisor agent (outer loop with a step limit) picks tools until the task is done. Sub-agents have their own inner loops ("agent as a tool"): the supervisor only sees their result.
- CRAG stays a code-driven workflow and becomes the document tool `search_documents`; agents call it, they do not replace it.
- Agents are roles (few: web researcher, writer). Tools are actions (many: `send_email`, `count_documents`). A new kind of task usually needs a new tool, not a new agent; Step 6 MCP adds tools without changing agent code. When no tool fits, the supervisor does what it can and says what it could not do.
- Any tool that sends, changes or costs money waits for human approval (reuse the Step 5 interrupt).
- Every tool takes the full user object and respects roles (`getAccessibleDocumentIds(user)`).
- Example task: "Check if PO-xxx followed the approval policy, find today's steel price, and email a short report to the finance lead."

### Tasks

- [ ] 1. Tools: `search_documents` (wraps CRAG, keeps role access), `web_research` (Step 5 web agent), `count_documents`, `send_email` (`email.service.js`)
- [ ] 2. Writer agent: turns facts into a report or email draft
- [ ] 3. Supervisor agent: LangGraph loop with a step limit
- [ ] 4. Approval before risky tools: Allow, Edit, Cancel
- [ ] 5. APIs: create a task, stream its steps, resume; task storage (schema change needs approval)
- [ ] 6. Frontend Tasks page (live agent steps, approval buttons); update `docs/frontend-rbac-prompt.md`
- [ ] 7. Eval: about 10 tasks with expected results; measure how many finish correctly
- [ ] 8. Update `AGENTS.md`, `ROADMAP.md`, and add a `docs/pipeline.js` entry

## Step 5C: Document intake automation (later)

Parked 14 Nov. Trigger + steps + action: when the document worker finishes an upload, queue a review task (BullMQ); agents compare the new document with existing policies and look up outside facts; the admin approves; the review is emailed to users whose roles can see that document.

## Step 6: Model Context Protocol (MCP) Server & Client (about 2-3 days)

Next after Step 5 (decided 16 Nov; Step 5B is dropped because chat is for search, not tasks). Goal: learn MCP beyond tool calling, on use cases about search where MCP is the right tool. MCP earns its place when an AI app picks tools it discovers at runtime; a fixed action (such as "import this Drive link") is plain API code and is not an MCP use case. Every MCP tool must take the full user object and respect roles, or counts and lists leak.

### What MCP offers (who decides)

- Tools: the model picks them (actions).
- Resources: the app or user attaches them (read-only data).
- Prompts: the user picks them (saved templates, like slash commands).
- Server-to-client requests: elicitation (ask the user mid-call), sampling (borrow the client's model), progress and logging notifications.
- Transport: Streamable HTTP mounted on Express (`/mcp`); stdio only for local testing.

### Part A: MCP server, your search inside other AI apps (learn the server side)

A user in Claude Desktop, VS Code Copilot or Cursor asks about company documents; that app discovers this server, reads its tools and calls them. Same services as the REST API, a new door.

- [x] A1. Tools: `search_documents` (runs CRAG without streaming, returns answer and sources), `list_my_documents`, `get_summary`, `get_page`
  - Done 16-17 Nov in `src/mcp/mcp.server.js` (`buildMcpServer(user)`, one server per user) and `src/routes/mcp.routes.js` (`/mcp`). `get_page` reuses `chatRepository.getChunksByPage`; missing and forbidden documents both answer "Document not found."
- [-] A2. Auth: token -> user -> roles (a per-user token to start, OAuth 2.1 later), so RBAC holds; audit log of who called what and when
  - Inactive (17 Nov): `/mcp` uses the login JWT through `requireAuth` (7-day token), which already gives RBAC. Per-user MCP tokens, revoking and the audit table are not needed for learning.
- [-] A3. Resources: `doc://{id}/summary` and `doc://{id}/page/{n}` (resource templates), only documents the user's roles allow, so a user can attach a document to the chat like a file; list-changed notification when the worker finishes an upload
  - Inactive (17 Nov): little value for a search app; `get_summary` and `get_page` already exist as tools.
- [-] A4. Prompts: saved templates such as `find-rule` and `compare-documents` (generic arguments, no test-document names)
  - Inactive (17 Nov): user-picked like resources, little value here.
- [x] A5. Progress and logging: CRAG steps ("round 1, grading, round 2") sent as progress notifications, the same events as the chat SSE
  - Done 17 Nov: `createProgressSender(extra)` turns CRAG `tool_start`, `status` and `agent_start` events into `notifications/progress` when the client sends a `progressToken`. Logging notifications not added.
- [~] A6. Elicitation: when a question is unclear (for example "what is the limit?"), the server asks back which document or policy is meant, then searches
  - Done differently 17 Nov: elicitation asks the human to allow the web search (replaces the UI Allow/Skip card for MCP callers); `/mcp` now uses sessions (`Mcp-Session-Id`, in-memory map, session bound to the user who opened it). Clients without elicitation, a decline or a 5-minute timeout continue with Skip. Clarifying questions are not built.
- [-] A7. Sampling and completions (optional): the server asks the client's model to write text; autocomplete document names in arguments
- [x] A8. Test with MCP Inspector, then Claude Desktop
  - Inspector verified 17 Nov (tools, RBAC, progress, approval form; request timeout raised to 300000 ms because CRAG takes 20 s-2 min).
  - Claude app verified 17 Nov (screenshot from the user): the server was added as "Ai Rag integration"; asked "from my documents What was the value of purchase order PO-10234", Claude found `search_documents` through its tool search on its own and answered USD 64,800 with the Purchase Order Log page 2 details and the incident report mention. This is the live (deployed) server.

### Part B: MCP client, planner sources from MCP servers (learn the client side)

Today the planner knows two sources, `documents` and `web` (hand-written Tavily code). With MCP the sources become a list read at runtime: CRAG connects to the configured MCP servers, reads their tools and descriptions, and the planner picks a source per hop. A new source is one line of config, no new code.

- [x] B1. MCP client in CRAG (`@modelcontextprotocol/sdk` or `@langchain/mcp-adapters`): connect to configured servers at start-up, list their tools
  - Done 17 Nov in `src/mcp/mcp.client.js` (SDK client): `MCP_SERVERS` config, one connection per server opened on first use, `getMcpTools(name)` returns the same `{ definition, run }` registry shape as `webTools`. Verified: Tavily MCP lists `tavily_search`, `tavily_extract`, `tavily_crawl`, `tavily_map`, `tavily_research`.
- [x] B2. Replace the hand-written web tools with the Tavily MCP server; keep the web approval and the parallel web agents as they are
  - Done 17 Nov (user applied the code, tested in the chat UI): only `tavily_search` and `tavily_extract` are allowed, results are cut to 6,000 characters, the tools reach the web agent graph through `config.configurable.tools`, and the built-in `web.tools.js` is the fallback when the MCP server is unreachable (`loadWebTools()` in `web.graph.js`). `agent_step` events now carry `mcpServer` (`"tavily"` or `null`); `collectSources` also reads URLs from MCP text results.
- [-] B3. Planner hop `source: "mcp"` with the tool name, chosen from the tool descriptions; same approval rule as web hops for anything that leaves the company
  - Inactive (17 Nov): needed only for B4.
- [-] B4. Add one more server (for example exchange rates or a read-only company database) and test a mixed question, e.g. "What is order X in euros, and is its supplier still active?" (documents hop -> amount, rates server -> today's rate, database server -> supplier status)
  - Inactive (17 Nov): for one app with one database a hand-written read-only SQL tool is simpler; B1/B2 already cover the client side. If picked up later, it needs a small B3 (planner source "database") and can reuse the web agent graph with database tools.
- [-] B5. Keep document hops on CRAG search; MCP sources never replace company documents (same rule as web facts)
  - Inactive with B3/B4.

### Finish Step 6

- [x] Update `AGENTS.md`, `ROADMAP.md`, `docs/architecture.html`, `docs/frontend-rbac-prompt.md` (if any API changes), and add a `docs/pipeline.js` entry
  - Done 17 Nov (pipeline entry 73, AGENTS.md "MCP server and client", `/mcp` and Tavily MCP in the diagram, frontend prompt section 5).
- Optional later (not planned): OAuth 2.1 for `/mcp` (well-known metadata, `/register`, `/authorize`, `/token`) so ChatGPT and claude.ai custom connectors can connect; today only clients that send a Bearer header work (Claude Code, Claude Desktop through `mcp-remote`, Inspector).
- Removed 16 Nov: Google Drive import (a fixed action, plain API code, not an MCP use case) and the 5B supervisor as the MCP client.

### Finish (after Step 6)

- [ ] README with the architecture pictures and eval numbers
- [ ] Short demo video: a question, a task with approval
- [ ] Stop adding features; fix what the demo shows
