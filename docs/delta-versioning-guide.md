# Delta versioning: how "replace a document" works

> **How to read this file:** in VS Code press **Ctrl+Shift+V** (or right-click the tab → *Open Preview*). The preview uses a clean font, and every blue link opens the code at the exact line.
> Written 19 November 2026. Line numbers match the code on that day; if a link lands a few lines off, the function is right there.

---

## Contents

1. [The idea in one minute](#1-the-idea-in-one-minute)
2. [Words used in this guide](#2-words-used-in-this-guide)
3. [The example used everywhere](#3-the-example-used-everywhere)
4. [What is stored in the database](#4-what-is-stored-in-the-database)
5. [Flow A: first upload (v1)](#5-flow-a-first-upload-v1)
6. [Flow B: the replace request (v2 arrives)](#6-flow-b-the-replace-request-v2-arrives)
7. [Flow C: the replace job in the worker](#7-flow-c-the-replace-job-in-the-worker)
8. [Flow D: watching progress](#8-flow-d-watching-progress)
9. [Flow E: chat and search only see the current version](#9-flow-e-chat-and-search-only-see-the-current-version)
10. [Flow F: "What changed" for the UI](#10-flow-f-what-changed-for-the-ui)
11. [Building blocks, explained slowly](#11-building-blocks-explained-slowly)
12. [Nuances (the small things that matter)](#12-nuances-the-small-things-that-matter)
13. [What is not built yet](#13-what-is-not-built-yet)
14. [Cheat sheet: every function in one table](#14-cheat-sheet-every-function-in-one-table)

---

## 1. The idea in one minute

Before this work, uploading a new version of a policy meant uploading a **new document**: new ID, roles to set again, old chats pointing at a document that is no longer current, and the AI reading and embedding everything again.

Now an admin can **replace** a document:

```
Upload v1  → save the chunks (as before) + save the PDF's sentences with a fingerprint each
Replace v2 → Gate 1: same file bytes?            → stop, nothing to do (no AI)
           → Gate 2: same sentences?             → stop, nothing to do (no AI)
           → something changed: AI reads v2, the chunker makes chunks
           → compare new chunks with old chunks by their fingerprint:
                 same text  → KEEP   the old chunk (same ID, same embedding)
                 new text   → ADD    a new chunk (embed it)
                 text gone  → REMOVE the old chunk (mark it; never delete it)
           → switch to the new version in one database transaction
```

**What you gain:**
- Same document ID, same roles, same chats.
- Unchanged chunks keep their IDs, so old chat answers still point to real chunks.
- Only changed chunks are embedded again.
- A file with no real change costs **zero** AI calls.
- The UI can show **what changed** between versions.

**What you do not gain yet:** the AI still reads the **whole** new PDF when something changed. Sending only the changed pages to the AI (ROADMAP Step 3, item 8) was skipped for now.

---

## 2. Words used in this guide

| Word | Meaning | Example |
|---|---|---|
| **Unit** | One small piece of the PDF's own text: a sentence, a table row, or a short line (heading, list item). Read from the PDF for free, no AI. | `Records are kept in the finance system, not in personal email folders.` |
| **Hash** (fingerprint) | A short code made from text. Same text → same code. One letter different → completely different code. | `"six years"` → `a3f9…`, `"eight years"` → `71c2…` |
| **Parent chunk** | A bigger piece of the AI's Markdown (up to 1,024 tokens), usually one section. Used for answers. | the whole of "## 7. Records" |
| **Child chunk** | A smaller piece of a parent (up to 256 tokens). Has the **embedding** (vector) used by search. | one paragraph of section 7 |
| **`text`** | The chunk's own words only. | `## 7. Records\n\nThe buyer keeps…` |
| **`searchText`** | `text` with the document title and section path in front. This is what gets embedded. | `Document: Equipment Purchase Policy\n\nSection: 7. Records\n\n…` |
| **`content_hash`** | Hash of `text`. Decides **keep or replace**. | |
| **`context_hash`** | Hash of `searchText`. Decides **embed again or not**. | |
| **Version** | `Document.version`: 1 after upload, +1 on each replace that changed something. | v1, v2, v3 |
| **`addedInVersion` / `removedInVersion`** | On every chunk: the version it first appeared in, and the version it was removed in (empty = still in use). | old section 7 chunk: added 1, removed 2 |
| **Gate** | A cheap check that can stop the work early. | Gate 1 = same file, Gate 2 = same sentences |

---

## 3. The example used everywhere

The test files are in [`delta-version-docs/`](../delta-version-docs/README.md): a 2-page made-up "Equipment Purchase Policy".

**v1 → v2 changed only these lines:**

| Where | v1 | v2 |
|---|---|---|
| Cover | Version 1.0, effective 1 March 2026 | Version 2.0, effective 1 July 2026 |
| Section 3, Table 1 | `5,001 to 50,000` → Head of Finance; `Above 50,000` → Managing Director | `5,001 to 40,000`; `Above 40,000` |
| Section 7 | records kept for **six** years | records kept for **eight** years |

**What really happened on 19 November** (document `02feb006-e179-4f36-8db6-7bb7dcd8b9ce`):

| Section | v1 chunk ID | After replace to v2 |
|---|---|---|
| Title and cover | `7e0319a4…` | **removed** (`removedInVersion = 2`), new chunk `d7974bf1…` added |
| 1. Purpose | `f2798ac0…` | kept, same ID |
| 2. Roles | `cf1ea6e3…` | kept, same ID |
| 3. Approval limits | `eee457fe…` | **removed**, new chunk `e57f5193…` added |
| 4. Quotes and supplier choice | `63284331…` | kept, same ID |
| 5. Emergency purchases | `3d70d473…` | kept, same ID |
| 6. New suppliers | `9bdd5396…` | kept, same ID |
| 7. Records | `7658bcf7…` | **removed**, new chunk `ae718fff…` added |
| 8. Breaches | `e3b1ad19…` | kept, same ID |

6 parents kept, 3 replaced, and only 3 child chunks were embedded again. 48 of 48 units were linked to their chunks.

Keep this table in mind: every flow below explains one part of how we got here.

---

## 4. What is stored in the database

Schema: [`prisma/schema.prisma`](../prisma/schema.prisma#L71). Two migrations added these fields on 18 November: `20261118103110_delta_versioning` and `20261118103600_chunk_version_indexes`.

### `Document` ([schema line 71](../prisma/schema.prisma#L71))

| Field | What it holds | In the example |
|---|---|---|
| `fileHash` | SHA-256 of the PDF bytes (Gate 1). Empty for documents uploaded before 18 November until their first replace. | v2's hash `b5823460fa28…` |
| `version` | 1 after upload, +1 per real replace | `2` |
| `updatedAt` | set automatically on every change | the time of the replace |
| `filename`, `fileUrl` | now point to the **latest** file | `Equipment-Purchase-Policy_v2.pdf` |

### `ParentChunk` ([line 90](../prisma/schema.prisma#L90)) and `ChildChunk` ([line 107](../prisma/schema.prisma#L107))

| Field | What it holds |
|---|---|
| `addedInVersion` | the version the chunk first appeared in (default 1, so every old chunk is "added in 1") |
| `removedInVersion` | empty = in use; a number = removed in that version (kept for history) |
| `metadata.content_hash`, `metadata.context_hash` | the two fingerprints (in `metadata`, not separate columns) |
| index `(documentId, removedInVersion)` | makes "chunks in use for this document" fast |

### `DocumentUnit` ([line 149](../prisma/schema.prisma#L149)): new table

The sentence list of the **current** version. It is like the index at the back of a book: "this sentence → it is in that chunk".

| Column | Why it exists | Example row |
|---|---|---|
| `position` | the order; the diff needs it | `46` |
| `kind` | `sentence`, `row` or `line` | `sentence` |
| `text` | the sentence itself (so the old PDF never has to be downloaded again) | `The buyer keeps the quotes, … for eight years after the order is closed.` |
| `hash` | its fingerprint; Gate 2 compares these | `9c1e…` |
| `page` | the page it starts on | `2` |
| `parentChunkId` | the parent chunk that holds it (empty if no chunk matched) | `ae718fff…` |

Rules: one row per `(documentId, position)`; deleting a document deletes its units (`onDelete: Cascade`); if a chunk were deleted, the unit's link becomes empty (`SetNull`).

---

## 5. Flow A: first upload (v1)

Upload existed before; three things were added: the **file hash**, the **unit list**, and **v5 chunks with fingerprints**.

### Step A1. Route

[`document.routes.js` line 19](../src/routes/document.routes.js#L19): `POST /api/documents/upload` → `requireAuth` → `requireAdmin` → `upload.single("file")` (Multer keeps the file in memory) → `uploadDocument`.

### Step A2. Controller: `uploadDocument`

[`document.controller.js` line 133](../src/controllers/document.controller.js#L133)
- Puts the PDF in Supabase Storage under `<adminId>/<time>-<filename>`.
- Calls the service, answers `202` ("accepted, working in the background").

### Step A3. Service: `processAndSaveDocument`

[`document.service.js` line 9](../src/services/document.service.js#L9)
- Creates the `Document` row (status `PROCESSING`, version 1).
- Adds a job `"extract-and-embed"` to the Redis queue ([line 32](../src/services/document.service.js#L32)).

### Step A4. Worker: the upload job

[`document.worker.js` line 52](../src/workers/document.worker.js#L52) `startWorker` listens to the queue. For an upload job:

1. **Download once** ([line 79](../src/workers/document.worker.js#L79)): `aiService.downloadDocument(filepath)` returns the PDF bytes.
   *Why once:* the same bytes are needed three times (hash, AI extraction, units). Before, `extractDocument` downloaded the file itself.
2. **File hash** ([line 80](../src/workers/document.worker.js#L80)): `hashFile(fileBuffer)`.
3. **AI extraction** ([line 82](../src/workers/document.worker.js#L82)): `aiService.extractDocument({ …, buffer: fileBuffer })`. The `buffer` option ([`ai.service.js` line 696](../src/services/ai.service.js#L696)) means "use these bytes, don't download again".
4. **Chunking** ([line 149](../src/workers/document.worker.js#L149)): `aiService.buildDocumentChunks(...)` makes v5 chunks with `content_hash` and `context_hash` (see [section 11.4](#114-chunker-v5-builddocumentchunks)).
5. **Units** ([line 156](../src/workers/document.worker.js#L156)): `buildUnitIndex(fileBuffer, mimetype, parents, documentId)`.
6. **Embed** each child (unchanged code).
7. **Save** ([line 265](../src/workers/document.worker.js#L265)): `saveDocumentChunks(documentId, parents, units)`.
8. **Finish** ([line 275](../src/workers/document.worker.js#L275)): `status: "COMPLETED"` and `fileHash` are saved together.

### Step A5. `buildUnitIndex`: the sentence list

[`document.worker.js` line 30](../src/workers/document.worker.js#L30)
- PDF only (Word and text files have no PDF text layer; they still get a `fileHash`).
- `extractUnits(fileBuffer)` → the sentence list ([section 11.1](#111-extractunits-pdf--sentences)).
- `linkUnitsToChunks(units, parents)` → writes `parentChunkId` on each unit ([section 11.3](#113-linkunitstochunks-sentence--chunk)).
- Sends a progress event `units_linked` (`totalUnits`, `linkedUnits`).
- **If anything fails here, the upload does not fail.** It logs `units_failed` and saves no units. Units are an extra; the chunks are what chat needs.

### Step A6. Repository: `saveDocumentChunks`

[`document.repository.js` line 111](../src/repositories/document.repository.js#L111)
- One transaction: lock the document row (`FOR UPDATE`), insert parents, insert children (with vectors), then units.
- Units are saved **after** parents, because `parentChunkId` must point to a row that already exists.
- `deleteMany` before `createMany` keeps only one unit list per document.

**Example result after v1:** 9 parents, 9 children, 48 units (all linked), `version = 1`, `fileHash = cb95bf3d…`.

---

## 6. Flow B: the replace request (v2 arrives)

This part runs **while the admin waits** (about 1 second). It decides whether there is any work at all.

### Step B1. Route

[`document.routes.js` line 37](../src/routes/document.routes.js#L37): `PUT /api/documents/:docId` → `requireAuth` → `requireAdmin` → `upload.single("file")` → `replaceDocument`.

### Step B2. Controller: `replaceDocument`

[`document.controller.js` line 233](../src/controllers/document.controller.js#L233)
- Calls the service with the document ID and the uploaded file.
- `changed: true` → **202** "New version queued for processing".
- `changed: false` → **200** "No changes found; the document was not updated".
- Errors with a `statusCode` (400, 404, 409, 502) are sent as they are; anything else becomes a plain 500.

### Step B3. Service: `replaceDocument`

[`document.service.js` line 132](../src/services/document.service.js#L132). In order:

| # | Check | Fails with | Why |
|---|---|---|---|
| 1 | the ID looks like a UUID | 400 `Invalid document ID` | stop garbage early |
| 2 | a file was sent, and it is a PDF | 400 | units need a PDF text layer |
| 3 | the document exists (`getDocumentForReplace`, [repo line 198](../src/repositories/document.repository.js#L198)) | 404 | |
| 4 | `status === "COMPLETED"` | 409 | a half-processed or failed document has nothing safe to compare with |
| 5 | no replace job already running ([line 149](../src/services/document.service.js#L149)) | 409 | two replaces at once would mix versions |

Then the two gates:

**Gate 1, same file** ([line 162](../src/services/document.service.js#L162))
`hashFile(file.buffer) === document.fileHash` → return `{ changed: false, reason: "same_file" }`.
*Example:* uploading v1 again → `200 same_file`. No AI, no storage upload, nothing changes.

**Gate 2, same sentences** ([line 168](../src/services/document.service.js#L168))
1. `extractUnits(file.buffer)` → the new sentence list.
2. `loadOldUnits(document)` ([line 125](../src/services/document.service.js#L125)) → the old list:
   - from the `DocumentUnit` table (`getDocumentUnits`, [repo line 213](../src/repositories/document.repository.js#L213)), or
   - for documents uploaded before 18 November (no units saved): download the **old PDF** from Storage and read it once.
3. `diffUnits(old, new)` ([section 11.2](#112-diffunits-compare-two-sentence-lists)).
4. Nothing added and nothing removed (only "moved") → `{ changed: false, reason: "same_text" }`.
   *When does this happen?* The same text saved again as a new PDF (re-exported, new creation date): the bytes differ, so Gate 1 does not stop it, but every sentence is the same.

*Example v1 → v2:* `kept 43, added 5, removed 5, moved 0` → something changed → go on.

**Store the new PDF** ([line 192](../src/services/document.service.js#L192))
Path: `<uploader's id>/<time>-<filename>`. It uses the **original uploader's** folder, not the folder of the admin doing the replace, because `deleteDocument` checks that the file sits in the uploader's folder (`storagePathOf`, [line 57](../src/services/document.service.js#L57)).

**Queue the job** ([line 205](../src/services/document.service.js#L205))
Job `"replace-document"` with everything the worker needs: new `filepath`, `fileUrl`, `fileHash`, `filename`, `version` (old + 1) and `oldFilepath` (to delete the old PDF at the end).
Job ID is fixed: `replace-<docId>`. BullMQ refuses a second job with the same ID, and `removeOnComplete`/`removeOnFail` free the ID when the job ends.

**Answer:** `{ documentId, changed: true, version: 2, diff: { kept: 43, added: 5, removed: 5, moved: 0 } }`.

> **Important:** the `Document` row is **not** changed here. Version, file name and URL change only at the very end of the job. If the job fails, the document is exactly as before.

---

## 7. Flow C: the replace job in the worker

The worker sees a job named `"replace-document"` ([`document.worker.js` line 59](../src/workers/document.worker.js#L59)) and hands it to `runReplaceJob` instead of the upload code.

### `runReplaceJob(job, publishProgress)`

[`document-replace.service.js` line 91](../src/services/document-replace.service.js#L91)

| Step | Line | What it does | In the example |
|---|---|---|---|
| 0 | | event `replace_start { version: 2 }` | |
| 1 | [107](../src/services/document-replace.service.js#L107) | download v2, **full AI extraction**, v5 chunking | 9 new parents (temporary IDs) |
| 2 | [123](../src/services/document-replace.service.js#L123) | load the chunks in use (`getActiveChunks`, [repo line 222](../src/repositories/document.repository.js#L222)) and compare: `planChunkChanges(old, new)` | 6 kept, 3 added, 3 removed |
| 3 | [129](../src/services/document-replace.service.js#L129) | embed only added children + kept children whose `searchText` changed | 3 embeddings |
| 4 | [144](../src/services/document-replace.service.js#L144) | new sentence list, linked to the **final** chunk IDs | 48 units |
| 5 | [155](../src/services/document-replace.service.js#L155) | `saveReplacedVersion(...)`: the switch, in one transaction | version becomes 2 |
| 6 | [163](../src/services/document-replace.service.js#L163) | delete the old PDF from Storage | v1 file gone |
| 7 | | event `replace_complete` with the counts | |

If **any** step 1-5 throws: the new PDF is deleted, a `replace_failed` event is sent, and nothing in the database has changed. Chat keeps using v1.

### `planChunkChanges(oldParents, newParents)`: the heart of it

[`document-replace.service.js` line 32](../src/services/document-replace.service.js#L32). Pure logic, no database.

**1. Make a "pool" of old parents by fingerprint** (`poolByContent`, [line 18](../src/services/document-replace.service.js#L18)):

```
pool = {
  hash("## 1. Purpose …")           → [f2798ac0]
  hash("## 3. Approval limits … 50,000 …") → [eee457fe]
  hash("## 7. Records … six years …")      → [7658bcf7]
  … one entry per old parent
}
```

For old v4 chunks (saved before fingerprints existed), the hash is computed from their text on the spot (`contentHashOf`, [line 13](../src/services/document-replace.service.js#L13)).

**2. Walk the new parents in reading order; for each, take a match from the pool** (`takeMatch`, [line 29](../src/services/document-replace.service.js#L29)):

| New parent | Its hash in the pool? | Result |
|---|---|---|
| `## 1. Purpose …` | yes → `f2798ac0` | **kept**: the new parent takes the ID `f2798ac0` ([line 51](../src/services/document-replace.service.js#L51)) |
| `## 3. Approval limits … 40,000 …` | no (the text has 40,000 now) | **added**: keeps its new ID (`e57f5193`) |
| `## 7. Records … eight years …` | no | **added** (`ae718fff`) |

`shift()` takes the match **out** of the pool, so one old chunk can match only one new chunk. If v1 had the same paragraph twice and v2 once: one is kept, one is removed.

**3. Children of a kept parent are compared the same way**, inside that parent only:
- same `content_hash` → kept child (same ID).
- then `child.reembed = contextHashOf(new) !== contextHashOf(old)` ([line 65](../src/services/document-replace.service.js#L65)). The text is the same, but did the **title or heading path** change? Only then is a new embedding needed. If not, the old embedding details are copied over.

**4. Whatever is left in the pool was not found in v2 → removed** ([line 76](../src/services/document-replace.service.js#L76)): `eee457fe`, `7658bcf7`, `7e0319a4` and their children.

**5. Fix the reading-order links.** The chunker linked parents with their temporary IDs (`prevParentId`, `nextParentId`). Kept parents changed ID, so every link is re-pointed through the `finalId` map.

The result is a **plan**: `keptParents`, `addedParents`, `removedParentIds`, `keptChildren`, `addedChildren`, `removedChildIds`.

### Why a kept child might need a new embedding

The embedding is made from `searchText`, not `text`:

```
Document: Equipment Purchase Policy        ← title
Section: 5. Emergency purchases            ← heading path
When a machine breaks down …               ← text
```

In v3 the heading becomes "5. Urgent repairs". A paragraph under it may have **the same `text`** (kept, same ID) but a **different `searchText`** → its vector still says "Emergency purchases" → embed again. In v1 → v2 no heading changed, so `reembed` was false for all 6 kept children.

### `saveReplacedVersion(documentId, { plan, units, version, file })`

[`document.repository.js` line 240](../src/repositories/document.repository.js#L240). One transaction, in this order:

1. **Lock and check** ([line 247](../src/repositories/document.repository.js#L247)): `SELECT … FOR UPDATE`, then `current.version !== version - 1` → throw. If someone else replaced the document meanwhile, stop instead of mixing two versions.
2. **Mark removed** ([line 257](../src/repositories/document.repository.js#L257)): `removedInVersion = 2` on removed parents and children. Nothing is deleted.
3. **Update kept parents**: same text, but `searchText`, `metadata` (pages, `chunk_index`) and links may have changed.
4. **Insert added parents** with `addedInVersion = 2`.
5. **Kept children**: with `reembed` → update `searchText`, metadata and vector (raw SQL, because Prisma cannot write `vector` columns); without → update metadata only.
6. **Insert added children** with their new vectors.
7. **Replace the unit list** ([line 322](../src/repositories/document.repository.js#L322)).
8. **Update the document last** ([line 337](../src/repositories/document.repository.js#L337)): `filename`, `fileUrl`, `fileHash`, `version = 2`.

Because all of this is one transaction, chat sees **either** all of v1 **or** all of v2, never a mix.

---

## 8. Flow D: watching progress

[`streamProgress`, `document.controller.js` line 13](../src/controllers/document.controller.js#L13): `GET /api/documents/progress/:docId` (SSE).

**The problem:** during a replace the document stays `COMPLETED` (so chat keeps working). The stream used to see `COMPLETED`, send "completed" and close at once.

**The fix:**
- [Line 106](../src/controllers/document.controller.js#L106): if a `replace-<docId>` job is waiting or running, send `replace_running` and keep the stream open.
- [Line 67](../src/controllers/document.controller.js#L67): the stream ends on `replace_complete` or `replace_failed` (as it ends on `completed` for an upload).

Events of a replace: `replace_running` → `replace_start` → the usual extraction and chunking events → `replace_complete { version, parents: {kept, added, removed}, children: {…}, embedded }` or `replace_failed { message }`.

---

## 9. Flow E: chat and search only see the current version

Removed chunks stay in the tables. So **every** query that reads chunks must say "only chunks in use": `removedInVersion IS NULL`.

| Where | Function | What it covers |
|---|---|---|
| [`chat.repository.js` line 95](../src/repositories/chat.repository.js#L95) | `searchSingleDocument` | document chat: vector, identifier, phrase and keyword tiers (filter in each tier) |
| [line 249](../src/repositories/chat.repository.js#L249) | `searchAllUserDocuments` | global chat, same tiers |
| [line 415](../src/repositories/chat.repository.js#L415) | `getChunksByPage` | "show me page 2", also MCP `get_page` |
| [line 474](../src/repositories/chat.repository.js#L474) | `getDocumentText` | summary input |
| [line 521](../src/repositories/chat.repository.js#L521) | `getParentNeighbors` | previous/next chunk, section lead, chapter, table and reference expansion |
| [`document.repository.js` line 61](../src/repositories/document.repository.js#L61) | `getAllParentChunks` | chunk inspector list (and its child count) |
| [line 95](../src/repositories/document.repository.js#L95) | `getChildChunksByParentId` | chunk inspector children |

19 filters in `chat.repository.js` in total.

**One place is left open on purpose:** [`getParentChunkById`](../src/repositories/document.repository.js#L80). An old chat answer can still link to a removed chunk (for example `7658bcf7`, "six years"), and opening that link should still work.

**Example check after v2:** ask *"How long must purchase records be kept?"* → the only chunk in use for section 7 is `ae718fff` → "eight years". The old "six years" chunk cannot be found by search any more.

---

## 10. Flow F: "What changed" for the UI

### Route → controller → service → repository

1. **Route** [`document.routes.js` line 35](../src/routes/document.routes.js#L35): `GET /api/documents/:docId/changes?version=N` → `requireAuth` → `getVersionChanges`.
2. **Controller** [`getVersionChanges`, line 297](../src/controllers/document.controller.js#L297): passes `docId`, the user and `?version`; answers `200 { success, data }` or the error.
3. **Service** [`getVersionChanges`, `document.service.js` line 267](../src/services/document.service.js#L267):
   - checks the ID, then **access** (`canAccessDocument`; no access answers 404, same as "not found");
   - the document must have at least 2 versions; `version` defaults to the latest and must be between 2 and the current one;
   - gets added, removed and kept from the repository;
   - **pairs** old and new chunks of the same section (`sectionOf`, [line 256](../src/services/document.service.js#L256)): an old and a new chunk under "3. Approval limits" → one `changed` card with `before` and `after`; a new section alone → `added`; an old section alone → `removed`.
4. **Repository** [`getVersionChanges`, `document.repository.js` line 352](../src/repositories/document.repository.js#L352): three queries at once:
   - `addedInVersion = N` → the new chunks;
   - `removedInVersion = N` → the old chunks;
   - count of chunks added before N and not removed by N → `keptChunks`.

### Example answer for v2

```json
{
  "version": 2, "currentVersion": 2, "keptChunks": 6,
  "changes": [
    { "section": "Title and cover",     "type": "changed", "before": { "id": "7e0319a4…" }, "after": { "id": "d7974bf1…" } },
    { "section": "3. Approval limits",  "type": "changed", "before": { "id": "eee457fe…" }, "after": { "id": "e57f5193…" } },
    { "section": "7. Records",          "type": "changed", "before": { "id": "7658bcf7…" }, "after": { "id": "ae718fff…" } }
  ]
}
```

The frontend compares `before.text` and `after.text` line by line and colours removed lines red and added lines green (for section 3: `5,001 to 50,000` → `5,001 to 40,000`). The frontend contract is in [`docs/frontend-rbac-prompt.md`](frontend-rbac-prompt.md) under "Replace a document with a new version".

---

## 11. Building blocks, explained slowly

All in [`document-units.service.js`](../src/services/document-units.service.js) unless stated.

### 11.1 `extractUnits`: PDF → sentences

[Line 158](../src/services/document-units.service.js#L158). Three steps:

**a) `readPdfPages`** ([line 9](../src/services/document-units.service.js#L9)): `pdf-parse` reads the text that is already inside the PDF (free, about 30 ms). It gives printed **lines**, not paragraphs: a long sentence is cut wherever the page width ends.

```
page 2:
"The buyer keeps the quotes, the purchase order, the approval and the delivery"
"note for six years after the order is closed."
"Records are kept in the finance system, not in personal email folders."
```

**b) `removeRepeatedLines`** ([line 29](../src/services/document-units.service.js#L29)): removes page furniture (headers, footers, page numbers). A line counts as furniture when it sits in the top 2 or bottom 2 lines of at least half the pages (minimum 3 pages). `furnitureKey` ([line 54](../src/services/document-units.service.js#L54)) replaces digits with `#`, so "Page 1 of 9" and "Page 2 of 9" count as the same footer.
*Why:* if one page is added, every footer moves, and without this step the diff would report a change on every page.

**c) `buildUnits`** ([line 73](../src/services/document-units.service.js#L73)): turns lines into units with three rules:
1. A line with a **tab** is a table row → its own unit (`row`): `5,001 to 50,000 | Head of Finance | Two written quotes`.
2. A **wide** line that does not end with `. ? ! : ;` continues on the next line → keep collecting. "Wide" = 75% of the document's 90th-percentile line length (`wideLineLength`, [line 62](../src/services/document-units.service.js#L62)). This also works across a page break.
3. Any other line ends the block → split it into sentences at `. ? !` + space + capital letter.

Small helpers: `mergeNumberLabels` ([line 116](../src/services/document-units.service.js#L116)) keeps `1. Purpose` as one unit (otherwise "1." looks like the end of a sentence); `joinLine` ([line 127](../src/services/document-units.service.js#L127)) joins `mini-` + `competition` without a space.

Result for the example above:

```
unit 46  sentence  p2  "The buyer keeps the quotes, … for six years after the order is closed."
unit 47  sentence  p2  "Records are kept in the finance system, not in personal email folders."
```

Each unit gets `hash = hashText(text)` ([line 145](../src/services/document-units.service.js#L145)): `normalize` lowercases and evens out spaces, quotes and dashes first, so small typing differences do not count as changes.

**Why sentences and not pages or lines?** If v3 adds a paragraph on page 1, the last sentence of page 1 moves to page 2. A page fingerprint would say "every page changed". A line fingerprint would say "every wrapped line changed". A sentence fingerprint says "one paragraph added": the sentence is the same wherever it is printed.

### 11.2 `diffUnits`: compare two sentence lists

[Line 165](../src/services/document-units.service.js#L165)
- Uses the `diff` npm package (`diffArrays`), like `git diff` but for lists, comparing **only the hash**.
- Returns `kept`, `added`, `removed` and `moved`.
- **moved** = the same hash appears in both `added` and `removed`. This happens when a table crosses a page and the browser prints the table header again: the rows after an insert jump over that repeated header. Same text, other place → not a change.

*Example v1 → v2:* kept 43, added 5 (`Version 2.0`, `1 July 2026`, two table rows with 40,000, "eight years"), removed the 5 old ones.

### 11.3 `linkUnitsToChunks`: sentence → chunk

[Line 226](../src/services/document-units.service.js#L226)

The unit is the **PDF's** text: `Order value (GBP) | 5,001 to 50,000 …`. The chunk is the **AI's Markdown**: `Order value (GBP): 5,001 to 50,000`. Exact matching would fail, so it compares **words in order**:
- `matchWords` ([line 199](../src/services/document-units.service.js#L199)): lowercase letters and digits only, split at every other mark (`VEN-033` → `ven`, `033`).
- Candidates: only chunks whose `source_pages` include the unit's page (2-4 chunks).
- `chunkHoldsUnit` ([line 219](../src/services/document-units.service.js#L219)): 3 words or fewer → all must be found; longer → 90% in order.
- `cursor`: units and chunks are both in reading order, so the current chunk and the ones after it are tried first. A short unit like "Internal" then links to the right chunk.

Tested on all 50 knowledge-base documents: 3,395 of 3,401 units linked (99.8%). The 6 misses are a word the AI misread ("Ardmoor" stored as "Ardmooor"), so not linking them is correct.

*What it is for:* today, only bookkeeping. It is the base for item 8 (send only the changed section to the AI): a changed sentence → its neighbour's `parentChunkId` → that chunk's section.

### 11.4 Chunker v5: `buildDocumentChunks`

[`simple-chunking.service.js` line 631](../src/services/simple-chunking.service.js#L631). Three changes (version `ai-corrected-markdown-v5`, [line 12](../src/services/simple-chunking.service.js#L12)):

1. **No cut at a page break** ([line 982](../src/services/simple-chunking.service.js#L982)). A parent ends only at the end of its section or at 1,024 tokens.
   *Why:* v4 started a new parent at every page. In v3 the new paragraph pushes text onto page 2, which would move every later cut and change every later chunk's hash. Now an insert only changes chunks in its own section.
   The page is not lost: `page_number` (first page) and `source_pages` (all pages, e.g. `[1, 2]`) stay in metadata, and "show me page 2" still finds a chunk that starts on page 1.
2. **Reprinted headings are dropped** ([line 566](../src/services/simple-chunking.service.js#L566)). The AI often writes the section heading again at the top of the next page. Without the page cut, it would appear twice in one chunk, and whether it is there would depend on where the page breaks.
3. **Two fingerprints** ([lines 952-969](../src/services/simple-chunking.service.js#L952)): `chunkHash` ([line 17](../src/services/simple-chunking.service.js#L17)) on `text` (`content_hash`) and on `searchText` (`context_hash`), for parents and children. It only evens out spaces: case and punctuation still count, because "CEO" → "CFO" is a real change in an answer.

---

## 12. Nuances (the small things that matter)

**Safety**
- **Chat keeps working during a replace.** `status` stays `COMPLETED`, and search reads the old chunks until the final transaction commits. The switch happens at once.
- **A failed replace changes nothing.** The `Document` row is only touched in the last step of the transaction. On failure the uploaded new PDF is deleted.
- **One replace at a time per document.** The fixed job ID `replace-<docId>` and the version check in the transaction both protect against two replaces mixing.
- **Removed chunks are never deleted.** Old chat answers keep valid chunk IDs. The cost is that rows pile up with each version (no cleanup yet).

**Why two kinds of hash**
- **Units** use `hashText`, which **lowercases**: they only need to find "did this sentence change?", and case noise from the PDF should not count.
- **Chunks** use `chunkHash`, which keeps case: a chunk's text is what the answer shows, so any visible change counts.
- **The file** uses `hashFile`: exact bytes, for "is this the very same file?".

**Gate 2 counts sentences, not chunks.** The `diff` in the 202 answer says "5 lines added, 5 removed". The `replace_complete` event says "3 parents replaced". Both are right; they count different things.

**The AI is not exactly repeatable.** When a section is read again, an unchanged line can come back slightly different (spacing, bold). That chunk then counts as changed and is embedded again. It costs a little time, never a wrong answer. In the v1 → v2 test it did not happen.

**Old documents (uploaded before 18 November):**
- no `fileHash` → Gate 1 is skipped once;
- no units → Gate 2 downloads the old PDF and reads it once;
- v4 chunks were cut at every page → on their **first** replace most chunks change once (because v5 cuts differently). From the second replace on, only real changes count.

**Scanned PDFs** have no text layer → 0 units → Gate 2 is skipped (`diff: null`), and the job still works by comparing chunks.

**The summary is not regenerated** after a replace. (Planned rule for later: regenerate when more than about 10% of the text changed.)

**`filename` follows the latest file.** After v2 the document is called `Equipment-Purchase-Policy_v2.pdf`.

**The old PDF is deleted at the end**, and errors there are ignored on purpose: a leftover file does no harm.

**Units are saved for the current version only.** Each replace overwrites the list, because the next replace only needs to compare with the version in use.

---

## 13. What is not built yet

| Item | What it would add |
|---|---|
| Step 3 item 8 (skipped) | Send only the changed pages or sections to the AI (the real cost saving). The unit → chunk links are the base for it. |
| Tests still to run | v2 → v3 (the reflow, a renamed heading, a removed sentence), the chat questions in [`delta-version-docs/README.md`](../delta-version-docs/README.md), a scanned PDF, a missing old file. |
| Summary refresh | Regenerate the summary when much of the text changed. |
| Cleanup | Remove chunks of very old versions (for example keep the last 3). |
| Other formats | Replace works for PDFs only. |
| Docs | AGENTS.md, `docs/architecture.html` and a `docs/pipeline.js` entry are to be written after the v3 test. |

---

## 14. Cheat sheet: every function in one table

| File | Function | Job in one line |
|---|---|---|
| [`document.routes.js`](../src/routes/document.routes.js#L35) | `GET /:docId/changes`, `PUT /:docId` | the two new routes |
| [`document.controller.js`](../src/controllers/document.controller.js#L233) | `replaceDocument` | 202 if changed, 200 if not |
| [`document.controller.js`](../src/controllers/document.controller.js#L297) | `getVersionChanges` | returns the "what changed" data |
| [`document.controller.js`](../src/controllers/document.controller.js#L13) | `streamProgress` | keeps the stream open during a replace |
| [`document.service.js`](../src/services/document.service.js#L132) | `replaceDocument` | checks, Gate 1, Gate 2, store the new PDF, queue the job |
| [`document.service.js`](../src/services/document.service.js#L125) | `loadOldUnits` | old sentence list from the table, or from the old PDF |
| [`document.service.js`](../src/services/document.service.js#L57) | `storagePathOf` | URL → safe storage path (shared with delete) |
| [`document.service.js`](../src/services/document.service.js#L267) | `getVersionChanges` | pairs old and new chunks per section |
| [`document-replace.service.js`](../src/services/document-replace.service.js#L91) | `runReplaceJob` | the whole replace job, step by step |
| [`document-replace.service.js`](../src/services/document-replace.service.js#L32) | `planChunkChanges` | keep / add / remove by fingerprint |
| [`document-units.service.js`](../src/services/document-units.service.js#L158) | `extractUnits` | PDF → sentence list |
| [`document-units.service.js`](../src/services/document-units.service.js#L165) | `diffUnits` | compare two sentence lists |
| [`document-units.service.js`](../src/services/document-units.service.js#L226) | `linkUnitsToChunks` | sentence → the chunk that holds it |
| [`document-units.service.js`](../src/services/document-units.service.js#L152) | `hashFile` | fingerprint of the whole file |
| [`simple-chunking.service.js`](../src/services/simple-chunking.service.js#L17) | `chunkHash` | fingerprint of a chunk |
| [`ai.service.js`](../src/services/ai.service.js#L661) | `downloadDocument` | get a file's bytes from Storage |
| [`document.worker.js`](../src/workers/document.worker.js#L30) | `buildUnitIndex` | units + links at upload (never fails the upload) |
| [`document.repository.js`](../src/repositories/document.repository.js#L111) | `saveDocumentChunks` | upload save, now with units |
| [`document.repository.js`](../src/repositories/document.repository.js#L222) | `getActiveChunks` | chunks in use, for the comparison |
| [`document.repository.js`](../src/repositories/document.repository.js#L240) | `saveReplacedVersion` | the switch to the new version, one transaction |
| [`document.repository.js`](../src/repositories/document.repository.js#L352) | `getVersionChanges` | added, removed and kept chunks of one version |
