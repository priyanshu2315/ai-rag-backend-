# Extraction and chunking fixes: what changed and why

## Context
Node.js/Express backend for a boiler tender proposal POC. Uploaded PDFs are read page by page by a
vision LLM. It runs in batches of 5 pages, gets each page image plus the PDF text layer, and returns
Markdown per page as JSON. The chunker (`src/services/simple-chunking.service.js`) then turns those
pages into section passages and search snippets. The extraction model is NVIDIA
`nvidia/nemotron-3.5-super-vl-120b-a12b`, chosen because production needs an open-source,
non-Chinese model.

We compared Nemotron's chunks for a 10-page test report (`northwind_fy2025_report.pdf`) with the
original PDF and found 5 problems:
1. The extraction instructions still contained examples from an older project (SOPs, CFO letters,
   organisation names). These leaked into the output.
2. A fake section "CFO restatement letter" appeared on page 1.
3. A running header and footer ("Northwind Beverages Ltd. — FY2025 Annual Performance Review Page N")
   stayed in the text. The model sometimes made it a `##` heading, which created fake sections and
   tiny snippets.
4. Charts came out as image placeholders (`![...]`) without their values.
5. The org chart's reporting lines were guessed.

## Fix 1: rewrote the extraction instructions
File: `src/instructions/document-extraction.js` (rewritten).
- Removed every example from the old project.
- Organised the instructions into sections: PAGE FURNITURE, TITLE AND HEADINGS, TABLES,
  FIGURES AND SCANNED IMAGES, CONTENTS PAGES, OUTPUT RULES and DOCUMENT STRUCTURE.
- PAGE FURNITURE: remove running headers and footers, page numbers, banners and logos. Don't add
  `---` at page ends.
- TITLE AND HEADINGS: if a company name and a report title are both printed as the title, combine
  them in `documentTitle`. Use `##` for top-level sections and annexures, `###` for sub-sections,
  `####` for the next level. Don't repeat headings at page breaks and don't add "(continued)".
- CONTENTS PAGES: no dot leaders. Write each entry once as `- 7.2 Title — 12`, taking page numbers
  from the image, not the text layer.
- Note: the title rule still uses the Northwind test report as its example.

## Fix 2: a boundary title must be printed on the page
Root cause: the fake "CFO restatement letter" section was not the model's fault. In
`detectDocumentBoundary()` (`src/services/simple-chunking.service.js`), a hard-coded regex turned any
page whose first lines contained "Office of the Chief Financial Officer" into a sub-document with that
title. Page 1 says "Prepared by the Office of the Chief Financial Officer".

What changed:
- Removed the hard-coded fallbacks: CFO letter, "MINUTES OF MEETING", "FACTORY ACCEPTANCE TEST
  RECORD", and the rule that let a top-level section title from the contents become a boundary.
- New rule: a page starts a sub-document only if it is an appendix, annexure, annex, exhibit or
  attachment, **and** its title is printed in the page's first 6 lines. "Printed" means at least 80%
  of the title's words appear there (`titleIsPrinted()`). The boundary is checked in this order:
  1. a contents-outline entry for this page whose title is printed on it;
  2. the model's `isDocumentBoundary` / `boundaryTitle`, accepted only if the title is printed;
  3. an `Appendix|Annexure|Annex|Exhibit|Attachment <code> …` heading among the first lines.
- `src/services/ai.service.js`: changed the JSON schema descriptions for `isDocumentBoundary` and
  `boundaryTitle` to say "only when this page starts a part printed with its own heading; copy that
  heading exactly". The old "CFO Restatement Letter" examples are gone.
- `src/services/document-outline.service.js`: `appendixPattern` now also matches "Annexure".

## Fix 3: running headers and footers are removed in code
New file: `src/utils/page-cleanup.js`, exporting `removeRunningLines(pages)`. It is called in
`extractDocumentWithAI()` (`ai.service.js`) after all batches finish and before chunking. It also sends
a `running_lines_removed` progress event that lists each removed line and how many pages it was on.

How it works:
- Only runs on documents with at least 3 pages. A line counts as "running" if it appears on at least
  max(3, half of the pages).
- Matching ignores heading marks, case and punctuation, so "Ltd. — FY2025" equals "Ltd. FY2025".
- A line is removed in either of two cases:
  - **Exact repeat:** a plain, non-heading line of at least 15 characters, the same on most pages
    (for example "SYNTHETIC POC DOCUMENT – NOT FOR COMMERCIAL USE PROP-017 · CFG-AFBC-90-V2").
  - **Repeat except for the page counter:** the line contains the word "page", or ends with that
    page's own number, and is otherwise identical on most pages.
- Safeguards that keep real content:
  - Table rows and list items are never removed.
  - Headings are removed only if they contain the word "page". So a table caption repeated on
    continued pages stays, and so does a numbered heading like "3. Consolidated…" on page 3.
  - Lines that start with a number never count as page counters.
  - Lines whose number is not the page number ("Batch 14 processed") stay.
  - Blank lines and `---` left at a page's start or end are trimmed.
- Tests: `tests/page-cleanup.test.js` (6 tests, all passing).

## Fix 4: figure rules
In the instructions (FIGURES AND SCANNED IMAGES):
- Never use `![...]`.
- Each figure is written as its caption in bold, followed by a list.
- Charts: axes, units and legend, then one line per bar, point, slice or month with its value.
  Values read from a scale get `~`; printed data labels are copied exactly.
- Flowcharts: one line per step, with values and highlighted markers such as "BOTTLENECK".
- Floor plans: one line per zone, plus exits, bays and measurements.
- Scanned forms and invoices: written as text, with their tables as Markdown tables;
  unreadable parts become `[unreadable]`.

## Fix 5: diagram rules
- Org charts: one line per person, as `- Role: Name — reports to: Manager role (Name)`.
- The model must follow the connector lines, including their colours.
- If a connector's end is not clear, it must write "reports to: unclear" instead of guessing.

## Related changes in the same uncommitted diff (from the Nemotron integration)
- `src/config/ai.js`: NVIDIA extraction request options `max_tokens: 16384` and
  `chat_template_kwargs: { enable_thinking: false }`. Without them the model spent its whole output
  budget on reasoning. These options also apply to the contents-outline retry.
- `ai.service.js`: dot leaders in the PDF text layer are collapsed to " … " before sending, because
  the model copied them endlessly.

## Results after the fixes (Nemotron, offline extraction and chunking)
Northwind (10 pages, 20 s), checked page by page against the PDF:
- Fixed: the fake section is gone. No header or footer lines and no `![...]` remain. The section paths
  are correct (1–9 plus "Appendix A. Specimen export invoice").
- Fixed: chart values on pages 2, 4, 5 and 6 match the PDF. The invoice is complete structured text.
- Still wrong:
  - **Org chart (page 9).** The model paired each manager with the box directly below them. 4 of 5
    reporting lines are wrong, and it did not write "unclear". The correct lines are:
    - CFO → VP Finance and Head of IR
    - COO → VP Manufacturing and VP Supply Chain
    - CTO → Head of Data Platform
    - CMO and Chief People Officer have no reports.
  - Floor plan (page 7): lists 4 emergency exits instead of 3.
  - Page 6: one paragraph is repeated and a stray `---` remains.

PROP-017 (35-page proposal, 181 s), checked for regressions: all checked values correct on pages 6,
14, 16 and 28; 79/79 BOM rows; no dot leaders.

Tests: 37 of 40 pass. The 3 failures are not caused by these changes: 2 tests in
`ai-corrected-ingestion.test.js` were already failing, and `document-delete.test.js` crashes before
running because it needs Node's `--experimental-test-module-mocks` flag.

## Still to do
- Restart the server and re-upload documents. Stored chunks keep the old extraction.
- Org charts: an instruction alone is not enough with this model. Options are a second, zoomed-in pass
  over the diagram that asks only for its connections, or treating reporting lines as unreliable.
- Nothing is committed yet.


---------------------------------------------------next-------------------


# Extraction & chunking fixes — problems and how they were solved

Context: Node/Express backend; PDF pages are read by a vision LLM in batches of 5
(page images + PDF text layer → Markdown per page as JSON), then a chunker builds
section passages and search snippets. Model here: NVIDIA Nemotron
(`nvidia/nemotron-3.5-super-vl-120b-a12b`); the same problems appear with Gemini.
Principle behind every fix: **never store model output as fact without a code-side
check; when a check fails, mark the item unclear rather than guess.**

Files in this project (for reference when porting):

| Area | File |
|---|---|
| Extraction orchestration | `src/services/ai.service.js` (`extractDocumentWithAI`) |
| Model instructions | `src/instructions/document-extraction.js` |
| Page cleanup | `src/utils/page-cleanup.js` (new) |
| Contents / appendix outline | `src/services/document-outline.service.js` |
| Org-chart verification | `src/services/diagram-verification.service.js` (new) |
| Headerless tables | `src/services/table-header-resolution.service.js` (new) |
| Chunker | `src/services/simple-chunking.service.js` |
| Tests | `tests/page-cleanup`, `document-outline`, `diagram-verification`, `table-header-resolution`, `figure-context`, `heading-fold`, `extraction-overflow` |

---

## 1. Phantom "CFO restatement letter" section

**Problem.** Page 1 of any document saying "Prepared by the Office of the Chief
Financial Officer" became a sub-document titled "CFO restatement letter".

**Cause.** Not the model. The chunker's `detectDocumentBoundary()` had hard-coded
regex fallbacks from an old test document (`Office of the Chief Financial Officer`,
`MINUTES OF MEETING`, `FACTORY ACCEPTANCE TEST RECORD`, and "any top-level contents
title found in the header block"). The old project's chunker has the same code.

**Fix.** Removed all fallbacks. A page starts a sub-document only if:
1. a contents-outline entry that is an appendix/annexure/exhibit/attachment targets
   this page **and its title is printed in the page's first 6 lines**, or
2. the model flagged `isDocumentBoundary` **and** its `boundaryTitle` is printed there, or
3. one of the first 6 lines matches `^(?:[A-Z]\s+)?((?:Appendix|Annexure|Annex|Exhibit|Attachment)\s+[A-Z0-9]+\b.*)$`.

"Printed" = ≥ 80 % of the title's words (longer than 1 char) appear in the text,
case/punctuation-insensitive (`textHasTitle()` in `document-outline.service.js`).
Also removed the old examples from the extraction instructions and the JSON-schema
descriptions, which leaked into output.

## 2. Running headers/footers kept as text (and turned into `##` headings)

**Problem.** "Company — Report Page 3" stayed on every page; sometimes as a heading,
creating fake sections and tiny snippets. Instructions alone did not stop it.

**Fix (code).** `removeRunningLines(pages)` after extraction:
- A line is "running" if it appears on ≥ max(3, 50 %) of pages, either identical
  (plain lines ≥ 15 chars) or identical except for a page counter.
- Page counter = the word "page", or the page's own number as the last number of a
  line that does not start with a number. Headings count only with the word "page",
  so a numbered section heading ("3. Summary" on page 3) and a table caption repeated
  on continued pages survive.
- Table rows, list items and horizontal rules are never candidates; blank/`---` lines
  at page edges are trimmed.

## 3. Text the model adds that is not printed

**Problem.** Every page ended with `**References:** Figure 1`; captions/paragraphs
were sometimes written twice; a heading printed over two lines was copied with the
line break, so its tail ("depots)") became a paragraph.

**Fix (code, `cleanPageText`).** Per page: drop lines matching
`^\s*\*\*References:\*\*\s*\S.*$`; drop a paragraph (not table/list/heading, ≥ 20
chars) that repeats an earlier paragraph on the same page; join a heading with the
next line when that line is ≤ 80 chars and either closes a bracket the heading opened
or starts in lower case. Plus an instruction rule: citations only in the `references`
field, never a "References:" line, never the same caption twice.

## 4. Figures as `![...]` placeholders; chart values with no units in snippets

**Fix (instructions).** Never `![...]`; write the caption in bold, then a list: first
item = axes/units, second = legend, then one line per bar/point/slice (`~` for values
read off a scale). Flowcharts one item per step (no arrows on one line); floor plans
one item per zone with attached bays/exits.

**Fix (chunker).** A paragraph matching a caption pattern
(`Figure 1 ·`, `Figure 3a and Figure 3b ·`, `Table 7.1 –`, `Table E-1 -`, `Exhibit A ·`;
a sentence like "Table 1 presents…" does not match because no separator follows the
number) opens a figure scope; following list/table blocks belong to it until a heading
or ordinary paragraph. In `searchText`, a snippet whose figure values are not
preceded by their caption in that snippet gets `Figure: <captions joined>` (or
`Table: …`) inserted after the Section line. Near-duplicate captions are merged.
Stored `text` is unchanged; only the embedded `searchText` gains the prefix.

## 5. Org charts: reporting lines guessed with confidence

**Problem.** The model paired each box with the box directly below it (4 of 5 lines
wrong) and ignored "write unclear" instructions. A second pass agreed with the wrong
answer in some runs because both readings share the same position bias.

**Fix.** Pages whose figure caption matches org-chart words (or ≥ 2 list items with
"reports to") are read **three independent ways** from a 3200-px render:
1. per person: name, role, `reportsTo`, `lineClear`;
2. per connector line: colour, box it starts from, boxes it ends at;
3. per box: colour of the line touching its top edge and its bottom edge.
A line is stored only when all readings give the same single manager (3 handles
monochrome charts by abstaining when a colour is shared). The model's list is
replaced in the page text by:
`- Role: Name — reports to: Manager role (Name)` / `… reports to: unclear (connector
line could not be verified)` / `… none shown (top of chart)`, plus a line
"Reporting lines verified against the diagram: 7 of 11". Result on the test chart:
0 wrong, 3 unclear. This lowers the risk; it cannot remove it — surface "unclear" in
the UI as needing manual confirmation.

## 6. Contents page failing the whole document

**Problem.** `Contents mapping remains incomplete: appendix e` / `Conflicting
contents mapping` (intermittent). The code merged the model's structured outline
with page numbers parsed from the contents **page text** and threw on any
disagreement. The page text had shifted numbers (text-layer artefact) and the model
sometimes returned `sectionCode: "E", title: "Technical Notes"`.

**Fix.**
- Structured outline is primary; contents text only fills gaps. Conflicts, invalid
  pages and still-missing appendices become **warnings** (SSE event), never errors.
- Bare codes get their appendix code back from the contents line ("E" → "Appendix E").
- Accept the stuttered form "E - Appendix E - Notes"; parse the list form
  `- 7.2 Title — 12` as well as dot leaders. Merge key is punctuation-insensitive
  ("1.2 - How to read" = "1.2 How to read").
- **`verifyOutline(outline, pages)`** after all batches: find the constant shift
  (−3…+3) that makes most titles appear on their target page; an entry not found at
  its page but found on exactly one page within ±2 is corrected; entries never found
  (scanned appendices) are kept and reported; contents pages themselves never count.
  Overlaps between an appendix with a printed page count and a later entry: a page
  confirmed by its printed title wins, otherwise the printed count wins and the
  unconfirmed entry moves after the range.
- `appendixAtPage` ranges stay the chunker's priority for scanned appendices.

## 7. Tables printed without a heading row (the stress-test Section 5 table)

**Problem.** Rows came out as `| D01 | … |` with no header, so Markdown did not see a
table: values were stored without labels, and the rows continued on the next page
fell into the wrong section. The meaning of the columns was in a separate note
("5A. Column key").

**Fix (`resolveTableHeadings`).** Detect runs of ≥ 2 pipe rows whose second line is
not a delimiter row. Ask the model for headings **with the page's original text
±3 pages (and any page mentioning "column … table")**, requiring it to copy the
defining sentence into `evidence`. Accept the headings only if `evidence` is found
verbatim in that text (`isQuoteInDocText`) and the count matches; otherwise use
`Column 1…N`. Letter-only headings are expanded from the evidence in code
(`column A, fiscal 2022 operating cost` → `A: fiscal 2022 operating cost`). Insert
the header + delimiter above the rows and the quoted sentence **below** them (a line
above a continued table would join the previous section). A headerless run at the
top of the next page with the same column count reuses the headings without a call.
The chunker's existing same-header continuation then links page 4's rows back to
page 3's table and its section. Context is built from a snapshot of the original
page text, never from text this step inserted.

## 8. Heading numbering `5A.` and heading-only sections

- `getHeadingLevel` numbering regex now `^(\d+[A-Z]?(?:\.\d+)*)(?:[.\s\-]|$)`, so
  "5A." is top-level, not nested under "6.".
- A section containing only headings (chapter heading followed at once by its first
  sub-heading) is folded into the next section with content instead of becoming a
  passage of its own.

## 9. Model output cut off at the token limit

**Problem.** Intermittent `finish_reason: "length"` (the model looping, e.g. on dot
leaders) failed the whole document.

**Fix.** The batch request is a recursive `requestGroup(group)`: on `length`, split
the group in half and request each half (merging pages, outline entries, usage); a
single page is retried once, then fails with a clear message. Usage of all calls is
summed into the batch. Also: dot leaders in the PDF text layer are collapsed to `…`
before sending; `enable_thinking: false` and a 16k output cap for Nemotron.

## 10. Smaller things
- Chunk-export check rows now say "(chunk indexes)" — "0" meant passage 0, not a count.
- New SSE events (document progress): `contents_outline_warnings`,
  `contents_outline_verified`, `org_chart_verified` / `org_chart_unverified`,
  `table_headings_resolved`, `running_lines_removed`,
  `<provider>_extraction_batch_retry`, and `page_transcribed.cleanup`.
- Extra model calls (org chart ×3, table headings ×1) are appended to
  `extraction.correction.batches` with a `kind`, so token usage per document counts them.

## Porting notes for the old project
- Its chunker (`chunking.service.js`, `section-context-v1`) has the same
  `detectDocumentBoundary` fallbacks → apply §1 first; it removes the phantom section.
- §2, §3, §4 (chunker part), §8 are model-independent and can be copied as is.
- §5 and §7 need a `complete(options)` function that sends an OpenAI-style request
  with `response_format: json_schema`; with Gemini use `responseSchema` instead.
- §6 only applies if the old project maps appendices from the contents page.
- Known limits: diagram connectors remain model-dependent; a verified line can still
  be wrong if all three readings share the same misperception.



--------------------next----------------------------


# Extraction and chunking fixes (October 2026)

How each problem found in the Vantara test report was diagnosed and fixed, written so the same fixes can be ported to another project that uses the same pipeline: page images go to a vision model, the model returns Markdown, the Markdown is cleaned, and a remark-gfm chunker turns it into passages and snippets.

Every fix below follows the same rule: **the model's output is never trusted without a check in code**. Where code can repair the output safely, it does. Where it can't, the passage gets a warning so a person can check the value against the page image.

---

## 0. What to copy and where it runs

**New files (copy whole):**

| File | What it does |
|---|---|
| `src/utils/table-repair.js` | Joins table cells the model split over several lines, merges two heading rows into one, and promotes title-plus-column-names rows to a real heading. |
| `src/utils/page-cleanup.js` | Removes running headers and footers (also using the PDF text layer), stray "Page N of M" lines, invented citation lines, repeated paragraphs and caption numbers the page doesn't print, and trims text copied from the next page. |
| `tests/extraction-checks.test.js` | 18 tests covering everything below. |

**Changed files:** `src/services/ai.service.js` (extraction loop), `src/services/simple-chunking.service.js` (chunker), `src/instructions/document-extraction.js` (prompt), `src/config/ai.js` (batching per provider), `src/utils/chunk-export.js` (checks table).

**Order of steps after the model returns a page.** The order matters: tables must be repaired before the caption check, and the page-overlap trim must run before running-header removal.

```
model Markdown for one page
  → drop "# Document title" on later pages               (ai.service)
  → cleanPageText                                         (page-cleanup: citation lines, repeated paragraphs,
                                                           wrapped headings, "Page N of M" lines)
  → repairMarkdownTables                                  (table-repair: wrapped cells, two heading rows,
                                                           title + names rows)
  → removeUnprintedCaptions(text, pdfTextLayer)           (page-cleanup, PDFs only)
  → page.textLayer = pdf text (digital pages only)        (kept for the numbers check in the chunker)
after all pages:
  → verifyOutline / verifyOrgCharts / resolveTableHeadings (existing checks)
  → trimPageOverlap(pages, { textLayers })                 (page-cleanup)
  → removeRunningLines(pages, { textLayers })              (page-cleanup)
chunker (buildDocumentChunks)
  → caption placement vote, heading fixes, table continuation, form tables, snippet splitting,
    structure_warnings
```

The **PDF text layer** is what `pdf-parse` `getText()` returns for each page. It costs nothing (it is already read in order to send text alongside the images) and is the most reliable check available: on a digital PDF it contains every printed word exactly once, on the page where it is printed. A page counts as having a usable text layer only when it has at least 100 non-space characters, so scanned pages are never "checked" against an empty layer.

---

## A. Model requests

### A1. Free-tier 429 errors (Gemini)

**Problem.** `429 RESOURCE_EXHAUSTED … limit: 15 … Please retry in 54.9s` failed the whole document.

**Cause.** The free tier allows 15 requests per minute per model; nothing waited and retried.

**Fix.** Wait for the delay the provider states, then retry, at most 3 times and at most 2 minutes per wait. A **daily** quota (`PerDay` in the quota id) fails at once, because waiting wouldn't help.

```js
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 120_000;

function rateLimitWaitMs(error) {
  if (error?.status !== 429) return null;
  const details = (error.message ?? "") + " " + JSON.stringify(error.error ?? "");
  if (/PerDay/i.test(details)) return null;
  const stated = details.match(/retry in ([\d.]+)\s*s/i)?.[1] ??
    details.match(/"retryDelay"\s*:\s*"([\d.]+)s"/)?.[1];
  const header = error.headers?.get?.("retry-after") ?? error.headers?.["retry-after"];
  const seconds = stated != null ? Number(stated) : header != null ? Number(header) : 60;
  return Math.min(Math.ceil((Number.isFinite(seconds) ? seconds : 60) * 1000) + 1000, MAX_RATE_LIMIT_WAIT_MS);
}

const complete = async (options) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send(options);
    } catch (error) {
      const waitMs = rateLimitWaitMs(error);
      if (waitMs == null || attempt > MAX_RATE_LIMIT_RETRIES) throw error;
      await onEvent({ type: providerName + "_extraction_rate_limited", attempt, waitMs });
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
};
```

Use `complete` for **every** model call in extraction, including the org-chart and table-heading verification calls.

### A2. Batching per provider

**Problem.** One batch size didn't suit both providers. Gemini needs few requests (rate limit). Nemotron reads better one page at a time.

**Fix.** Each provider declares its own batching in `config/ai.js`, and `getAI("extraction")` returns it:

```js
gemini:  { …, extractionBatching: { batchSize: 5, concurrency: 1 } }, // 15 req/min free tier
nvidia:  { …, extractionBatching: { batchSize: 1, concurrency: 4 } }, // one page per request
const DEFAULT_EXTRACTION_BATCHING = { batchSize: 5, concurrency: 1 };
// in getAI:
...(task === "extraction" ? { batching: provider.extractionBatching ?? DEFAULT_EXTRACTION_BATCHING } : {})
```

The extraction loop takes `batchSize * concurrency` pages per window, splits them into groups of `batchSize`, runs the groups with `Promise.all`, and merges the results in page order. Take the title from the first group that has one and the continuation context from the last group. Page rendering (`pdf.getScreenshot`) must be serialised through a promise queue, because pdf.js does not like parallel renders on one document.

### A3. Text from the next page copied onto the previous page (prompt side)

**Problem.** Page 14 ended "Projects above USD 10 million (Hosur expansion …) were approved …", but the PDF's page 14 ends at "USD 10" and the rest is on page 15.

**Cause.** The request included the neighbouring page's text "for context", and the model copied it.

**Fix.** Don't send neighbour text. Add to the prompt:

```
A page may start or end in the middle of a sentence; its Markdown starts and ends there too.
Never complete a sentence with words that are not printed on that page.
```

The code-side safety net is B6.

### A4. Prompt rules for things only the model can get right

Added to the extraction prompt. These made a visible difference on the Gemini run:

```
TABLES:
Keep the table's caption where it is printed: on its own line above the table, or below it
when the page prints it below.
Write exactly one heading row, then one |---| row, and give every row the same number of cells.
Write each table row on one line: join a cell printed over several lines with spaces.
When the table has grouped headings (a "Pressure parts" heading above several columns),
join them into the column heading ("Pressure parts: Design pressure (bar)"); never write two
heading rows or a second |---| row.
Keep every printed column as its own column; never merge two neighbouring columns (such as
a code and a name) into one cell.
A form printed as label/value pairs ("Customer: …", "Test date: …") is written as a two-column
table of label and value, with the first pair in the heading row.
Never invent a table or figure number: if the page prints no caption, write none.
When a table continues on the next page, write the rest as a Markdown table too (never as
plain text) …

CHARTS:
… A value printed as a data label on or next to the bar, point or slice is copied exactly,
without ~. Check every bar, point and slice of every series for its own printed label.

SCANS AND FORMS:
Checkboxes and tick boxes: write ☑ for a ticked or crossed box and ☐ for an empty one,
followed by its label ("☑ Pass ☐ Fail"); never drop the box or its state.
Handwritten notes, margin notes and annotations: transcribe them as
"[Handwritten: <the words as written>]" on their own line after the paragraph or table row
they sit beside; never put printed words inside the brackets or split a printed line around
a note. Stamps and seals as "[Stamp: <its text>]"; signatures as "[Signature: <name>]" when a
name is printed or legible, else "[Signature]". Copy their words exactly, and write
[unreadable] for any word you cannot read.
```

**Keep prompt examples generic.** I first used words from the test document ("update Policy Table 7.1"), then replaced them. Examples taken from a real document prime the model to "find" them in other documents.

Results on Gemini: checkbox states, 3 handwritten notes and 4 stamps were captured, and the margin note "update Policy Table 7.1 !!" was read exactly. The `~` on printed labels still appeared on one chart series; see section E.

---

## B. Page cleanup (`table-repair.js`, `page-cleanup.js`)

### B1. Table with two heading rows (Table 4.2)

**Problem.** A table printed with group headings ("General | Electrical | Lifecycle") above column headings ("Segment | Chem. | Capacity (kWh) …") came back as two heading rows, or with the `|---|` row in the wrong place. remark-gfm then read the real column names as data ("Column 4: 500"), or did not see a table at all. Extra cells beyond the heading count became "Column 6".

**Cause.** GFM needs the delimiter row on line 2 with the same number of cells as the heading row. Anything else is not the table you meant.

**Fix.** `repairMarkdownTables(pageText)` finds each run of pipe lines and leaves well-formed tables alone. Otherwise:

1. Take everything above the **last** `|---|` row as heading rows.
2. A digit-free row right after the delimiter is also a heading row, while the heading rows don't yet name every column.
3. Width = the widest data row.
4. Labels:
   - if every heading row has that width, each column takes its lowest (most specific) non-empty name;
   - otherwise the row with the most names gives the labels, and the coarse group row fills a missing first or last label ("Model" and "Key features" span both rows).
5. Write one heading row, one delimiter row, and data rows padded to the width.

Run it on each page **before** the chunker parses the Markdown. The file is self-contained, so copy it whole.

### B2. Cells copied with their line breaks (Table 5.1, 5.2)

**Problem.** `| Plant | Name | Nameplate` ⏎ `(GWh/yr) | FY2025` ⏎ `production` ⏎ … ⏎ `subsidiary |`. One row became five lines. The first version of B1 then treated the fragments as heading rows and produced "(%)" as Table 5.2's first column.

**Fix.** Before anything else, join a line that opens with `|` but doesn't close with one to the following lines, up to the first line that closes with `|`. Stop if a line opens a new row (`|`) or is blank, or after 8 lines. Lines like `| a | b` with no closing pipes at all are left alone.

```js
// in repairMarkdownTables, first step
const wrapped = joinWrappedCells(String(text ?? "").split("\n"));
```

### B3. Headerless table that starts with a title row (FAT "TEST RESULTS")

**Problem.** `| TEST RESULTS | | | | |` ⏎ `| # | Check | Specification | Measured | Result |` ⏎ data rows, with no delimiter. The heading-resolution step found no verifiable heading and wrote "Column 1 … Column 5".

**Fix (in `repairRun`, only when there is no delimiter):**
- first row has exactly one non-empty cell;
- second row has every cell filled and no digits;
- at least one later row has a digit.

When all three hold, write the title as `**TEST RESULTS**` above the table and use row 2 as the heading row.

### B4. Stand-alone "Page 1 of 2" lines

**Problem.** A page counter printed in a scanned appendix became a snippet of its own.

**Fix (in `cleanPageText`):** drop lines that are only a page counter. Lines that merely mention a page ("See page 4") are kept.

```js
const PAGE_COUNTER_LINE = /^\s*(?:\*\*)?(?:page\s+\d+(?:\s*(?:of|\/)\s*\d+)?|-\s*\d+\s*-|\d+\s*\/\s*\d+)(?:\*\*)?\s*$/i;
```

### B5. Invented caption numbers ("Table A.1 - Glossary")

**Problem.** The model labelled the uncaptioned glossary table "Table A.1 - Glossary".

**Fix.** `removeUnprintedCaptions(pageMarkdown, pdfTextLayer)`. For each caption-like line (`Table|Tab.|Figure|Fig.|Exhibit|Chart` + number, in any bold, italic or heading form), the page's text layer must contain the same kind and number: "Table A.1" or "Tab. A.1", "Figure 4.4b" or "Fig. 4.4b". If it doesn't, the line is removed. Pages without a usable text layer (scans) are skipped.

```js
const CAPTION_LINE = /^\s*(?:#{1,6}\s+)?[*_]*(Table|Tab\.|Figure|Fig\.|Exhibit|Chart)\s*([A-Z]?[.-]?\d+(?:[.-]\d+)*[a-z]?|[A-Z])(?![\w.-]*\d)\b/;
// compare with: new RegExp(` ${word}\\s*${number} `) on ` ${clean(layer)} `
// clean = lower-case, every run of non-letters/digits → one space ("A.1" → "a 1")
```

Sanity check used during development: running it on each text layer against itself must remove nothing.

### B6. Text copied from the next page (code side)

**Problem.** Same as A3. The model can still do it even with the prompt rule.

**Cause of the first failed attempt.** A strict "end of page N equals start of page N+1" check missed it, because the model also copied page 15's figure caption **after** the copied sentence.

**Fix: `trimPageOverlap(pages, { textLayers })`.**
1. Split both pages into normalised words. Find the earliest place in the last 400 words of page N where the first ≥ 8 words of page N+1 start again.
2. Decide which page the text belongs to using the text layers:
   - printed on both pages → keep both;
   - printed only on page N → cut it from the start of page N+1, and only when the copy is the very start;
   - otherwise (printed on N+1, or no text layer) → cut page N from where the copy starts.
3. When cutting page N, anything after the copy is removed with it only if page N+1 also holds that text. This is how the copied caption goes.

Text layers are indexed by `sequenceIndex` (page 14 is index 13); keep that consistent with your page objects.

### B7. Running headers kept on only some pages

**Problem.** Nemotron kept "CONFIDENTIAL - Preliminary Edition …" on 8 of 24 pages. The existing rule needs a line on at least 50% of pages, so it survived.

**First attempt, and why it was dropped.** I lowered the threshold for lines at the top or bottom of a page to 20%. That also deleted a genuine sentence that ended 3 of 10 pages ("See Annexure A for details."). A model-only rule can't tell those cases apart.

**Fix.** Use the text layer. In the PDF itself the running header is printed on **every** page.
1. A line among the first or last 3 lines of at least half of the text-layer pages is running. It must match exactly (normalised); only page counters match with their numbers ignored.
2. Remove such lines from the model's Markdown **only where they appear in the first or last 3 lines of a page**. Never remove `# ` level-1 headings this way.

```js
removeRunningLines(pages, { textLayers: isPDF ? texts : null })
```

Note: matching every line with numbers ignored is wrong. "Body text 1", "Body text 2" … would all count as one running line. Only page counters may ignore numbers.

### B8. The document title repeated as `# Title` on a later page

**Problem.** Gemini wrote `# VANTARA ENERGY SYSTEMS Integrated Report FY2025` at the top of page 11. That inserted a heading block between the two halves of Table 4.2.

**Fix (in ai.service, where `# ` headings are normalised):** the title heading is kept once, on the first two pages only. Later copies are dropped.

```js
if (heading.trim() !== documentTitle) return "## " + heading;
if (hasDocumentHeading || item.sequenceIndex > 1) return "";
```

---

## C. Chunker (`simple-chunking.service.js`)

### C1. Cuts in the middle of a line, and pieces rejoined with a blank line

**Problem.** Oversized text was cut at the exact middle character, and the halves were later rejoined with `\n\n`. That put a paragraph break in the middle of a sentence or list item.

**Fix.**
1. `cutPoint(chars)` picks the newline nearest the middle; otherwise a sentence end (whitespace after `.;:!?`) in the middle half; otherwise the nearest space; only then the middle.
2. It returns the separator it removed, which is stored on the second piece as `joinWith`.
3. `bodyText` and `searchText` rejoin pieces with `joinWith` (default `\n\n` between different blocks).

```js
export function cutPoint(chars) {
  const middle = Math.floor(chars.length / 2);
  const nearest = (test, from, to) => {
    for (let distance = 0; distance <= chars.length; distance++) {
      for (const index of [middle - distance, middle + distance]) {
        if (index >= from && index <= to && test(index)) return index;
      }
      if (middle - distance < from && middle + distance > to) break;
    }
    return -1;
  };
  const last = chars.length - 2;
  const line = nearest((i) => chars[i] === "\n", 1, last);
  if (line !== -1) return { index: line, separator: "\n" };
  const quarter = Math.floor(chars.length / 4);
  const sentence = nearest((i) => /\s/u.test(chars[i]) && /[.;:!?]/.test(chars[i - 1] ?? ""), quarter, chars.length - quarter);
  if (sentence !== -1) return { index: sentence, separator: chars[sentence] };
  const space = nearest((i) => /\s/u.test(chars[i]), 1, last);
  if (space !== -1) return { index: space, separator: chars[space] };
  return { index: middle, separator: "" };
}

const joinPieces = (pieces) => pieces.map((p, i) => (i ? p.joinWith ?? "\n\n" : "") + p.text).join("");
```

### C2. A long table row split into single fields (G500-X)

**Problem.** A 15-column row longer than 256 tokens was split character by character. Fields ended up in different snippets with no row name.

**Fix.** A row that needs splitting is split into groups of **whole fields**. Each group starts with `Row identity: <first label>: <first value>` and later groups join with `\n`. Combined with C3, the G500-X row now fits whole (194 tokens).

### C3. The caption prefix used most of the snippet's tokens

**Problem.** A snippet that starts inside a table gets the table's caption as a prefix. Table 4.2's caption with its footnotes was about 300 characters.

**Fix.** `shortCaption`: a caption over 160 characters is cut to its first sentence (or to 160 characters + "…").

### C4. "Table 5.2 shows the supplier mix…" read as a caption

**Cause.** The old regex allowed the decimal point in "5.2" to act as the caption separator ("Table 5" + "." + "2 shows").

**Fix.** Read the number whole, and allow letter numbers such as "A.1" and "E-1":

```js
const CAPTION_NUMBER = String.raw`(?:\d+(?:\.\d+)*[a-z]?(?!\.?\d)|[A-Z](?:[.-]\d+)*(?!\.?\d))`;
const CAPTION = new RegExp(
  String.raw`^((?:Figure|Fig\.|Table|Exhibit|Chart|Diagram|Graph)\s*${CAPTION_NUMBER})\b` +
  String.raw`(?:\s+(?:and|&)\s+(?:Figure|Fig\.|Table)\s*${CAPTION_NUMBER})?\s*(?:[·.:–—-]|\()`, "i");
```

Also strip italic and bold markers before matching. Nemotron writes `*Table 5.3 - Project register.*`:

```js
const plain = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim().replace(/^[*_]+|[*_]+$/g, "").trim();
```

### C5. A caption printed below its table named the next table

**Problem.** The Vantara report prints captions **below** tables. The chunker assumed captions sit above and attached "Table 5.2 - Suppliers" to the next table, Table 5.3. The model, on the other hand, writes chart data **after** a figure caption. So the right direction depends on the document and on the kind of caption.

**Fix, in two parts.**

1. **Vote per caption kind per document** (`captionPlacement`). Parse every page once, then for each caption paragraph:
   - followed by a list/table and not preceded by one → vote "above";
   - preceded by one and not followed by one → vote "below";
   - a caption between two tables → no vote. This one matters: without it, Table 5.2 (between two tables) voted "above" and tied the count.

   Kinds with more "below" than "above" votes are below-style.
2. **Attach backwards** when the kind is below-style, or when the caption has no list or table after it (a chart whose values end the previous page). The caption then goes to the list or table block just before it, and to every block of the same table on other pages. Only blocks without a caption are taken, so a reprinted caption doesn't steal values that already have one.

```js
const previous = current?.blocks.at(-1);
const below = captionPlacing.below.has(caption.label)
  ? !previous?.figure || previous.figure === figure
  : !captionPlacing.dataAfter.has(node) && !previous?.figure;
if (below && previous && ["list", "table"].includes(previous.type)) {
  for (const block of allBlocks) {
    if (block === previous || (previous.tableId && block.tableId === previous.tableId)) block.figure ??= figure;
  }
  figure.below = true;
  activeFigure = null;
} else {
  activeFigure = figure;   // above-style: the caption names the next list/table
}
```

In `searchText`, a snippet gets the caption prefix only if the caption is not already in it. For a below-style figure that means anywhere in the snippet; for an above-style figure, before the values:

```js
if (!figure.captionBlockIds.some((id) => (figure.below ? blockIds : seenBlocks).has(id))) {
  context.push(figure.label + ": " + shortCaption(figure.captions.join(" — ")));
}
```

### C6. A chapter heading repeated at the top of a page reset the section

**Problem.** Page 11 starts with "## 4 Products and Technology" again. The rest of §4.2 was then filed under "4" alone.

**Fix.** Before the page has any real content (only headings and short lines so far), a heading whose path is a **strict ancestor** of the current path is a running header. Skip it entirely: no stack change, no block. Work out the new stack first and assign it only when the heading is accepted.

```js
const nextStack = [...headingStack.filter((h) => h.level < level), { level, title, depth: node.depth }];
const nextPath = nextStack.map((h) => h.title);
if (beforeFirstHeading && !pageContent && nextPath.length < currentPath.length &&
    nextPath.every((part, i) => part === currentPath[i])) continue;
headingStack = nextStack;
// pageContent becomes true once a block that is not a heading and not a short (<120 chars) paragraph is added
```

### C7. Doubled appendix paths ("Appendix A - Glossary > A Appendix A - Glossary")

**Cause.** The appendix starts a section from the boundary title. The model also writes the printed title (with the letter badge "A") as a heading, which then nested under itself.

**Fix.** While an appendix boundary is active, a heading that repeats the boundary title (after removing a leading single letter) stays in the text but does not change the path:

```js
function repeatsBoundaryTitle(title, boundaryTitle) {
  const heading = normalizeWords(title.replace(SUB_DOCUMENT_HEADING, "$1")); // strips "A " before "Appendix …"
  const boundary = normalizeWords(boundaryTitle);
  return Boolean(heading) && (heading === boundary || boundary.startsWith(heading + " ") ||
    (SUB_DOCUMENT_WORD.test(title) && heading.startsWith(boundary)));
}
```

### C8. Unnumbered sub-heading became a sibling ("4 > Certifications")

**Problem.** "### Certifications" under "## 4.2 Technical specifications" came out as "4 > Certifications".

**Cause.** Unnumbered headings get a fixed level, which is the same level as "4.2".

**Fix.** An unnumbered heading (no number and no appendix or contents word) written **deeper** in Markdown than the nearest numbered heading becomes its child. If the model writes both at the same depth, it is ambiguous and left as before. Store the Markdown `depth` on each stack entry.

```js
const parent = headingStack.findLast((h) => h.depth != null);
if (isPlainHeading(title) && parent && node.depth > parent.depth) level = Math.max(level, parent.level + 1);

function isPlainHeading(title) {
  const clean = title.trim();
  return !/^(?:section|clause|article)?\s*\d+[A-Z]?(?:\.\d+)*(?:[.\s-]|$)/i.test(clean) &&
    !/^(?:Table of Contents|Contents|Document Control|Appendix\s+[A-Z0-9]|Annex|Exhibit)/i.test(clean);
}
```

⚠️ Check the backslashes when you port this. My first version lost them when it was written through a shell heredoc (`s*d+` instead of `\s*\d+`). That made numbered headings count as unnumbered, so "### 3.3" written one level too deep nested under "3.2". A test now covers this ("a numbered heading written one level too deep stays a sibling").

### C9. Table continued on the next page not linked (Table 4.2)

**Problems.**
- The model writes the grouped headings slightly differently on each page: "General: Segment" on page 10, "General Segment" on page 11.
- On one run it also assigned two columns to different groups: "Electrical: RTE (%)" on page 10, "Lifecycle RTE (%)" on page 11.

**Fix, in two parts.**
1. Compare heading keys after `normalizeWords` (lower-case, punctuation removed), not just lower-cased.
2. Add a third, stricter match used only when the other two fail. It applies to a table at the top of the very next page, with the same number of columns (at least 3), where every column names the same thing:
   - equal;
   - one name ends the other ("Plant" / "Physical and site Plant");
   - equal after dropping the first (group) word.

   The continued rows then use the **first page's labels**, so the whole table is labelled consistently.

```js
function sameColumns(previous, next) {
  if (previous.length !== next.length) return false;
  return previous.every((label, i) => {
    const a = normalizeWords(label), b = normalizeWords(next[i]);
    if (!a || !b) return a === b;
    const rest = (w) => w.split(" ").slice(1).join(" ");
    return a === b || a.endsWith(" " + b) || b.endsWith(" " + a) || (rest(a) && rest(a) === rest(b));
  });
}
// relationship.match = "similar_column_headers"; tableLabels = table.labels for this match too
```

### C10. Label/value form written as a table (FAT record)

**Problems.**
- `| Product: | VoltCell G500-X |` was taken as the heading row, so every row read "Product:: Serial No.:".
- On other runs the heading row was generic ("Column 1 | Column 2", added by heading resolution) or the form's title.

**Fix.** In `blockPassages`, a table with an even number of columns is a form when either:
- the heading row is `Label: | value` pairs, in which case the heading row is data; or
- all body rows (at least 2) are pairs, in which case a generic heading row is dropped and a title heading row is kept as one line of text.

Each row becomes `Label: value` lines.

### C11. Blank top-left heading cell became "Column 1"

**Problem.** The India table prints nothing above its row names, so the result was "Column 1: Revenue (INR crore)".

**Fix.** Label an empty first heading cell "Row". Other empty headings stay "Column N".

### C12. Cross-reference junk and missing plurals

**Problems.**
- "the appendix prevails" produced "Appendix PREVAILS", and "APPENDIX AND NOTES" produced "Appendix AND".
- "Figures 3.1 to 3.4" and "Appendices B, C and D" were not recognised.

**Fix.**
- Appendix ids are case-sensitive: a single capital letter or a number (`/\bAppendix\s+([A-Z]|\d+)\b(?![.-]?\d)/g`). Figure numbers keep their letter ("Figure 4.4b").
- Plural forms (Appendices, Figures, Tables, Sections, Clauses) are followed by a list. Ranges (`to`, `through`, `–`, `-`) expand within one level, up to 50 items: 3.1–3.4 → 3.1, 3.2, 3.3, 3.4, and B–D → B, C, D. Anything else keeps just the two ends.

---

## D. Checks that flag instead of fixing (`structure_warnings`)

These are saved on each passage's `metadata.structure_warnings` and counted in the chunk export's Checks table. They never change the text.

### D1. `values_not_in_pdf_text`

Numbers in the passage that the page's text layer does not contain. On the Vantara report this caught exactly the values read from chart and diagram images (Figures 3.1, 3.4, 4.3, 4.4a, 4.4b, 4.5, 5.3, 6.1). Those are the values most likely to be misread.

- Only **whole** numbers are compared, so the digits of "Q1", "FY2025" and "G500" are not taken as values:
  `/(?<![\p{L}\d.,])\d[\d,]*(?:\.\d+)?(?![\p{L}\d]|[.,]\d)/gu`
- Commas and leading zeros are removed on both sides.
- Ignore text that code generated, such as "Column N" labels and the org-chart verification count line ("verified: 17 of 18"). Otherwise those numbers are flagged too.
- Only pages with a usable text layer are checked (`page.textLayer` is set only when the layer has at least 100 non-space characters).

### D2. `table_total_mismatch`

- A "Total" (or "Subtotal" / "Grand total") row must equal the sum of the rows since the previous total.
- A year column (FY…, Total, Year) must equal Q1+Q2+Q3+Q4 on every row.
- Allowed difference: half a unit in the last decimal place for each value added.
- Columns are skipped when the total is not larger than every part (a change %, an average or a ratio is not a sum), or when a part is negative or not a number.
- Tables that continue across pages are skipped, because their parts are on another page.

No false alarms on the Vantara report, where every total adds up. A test checks that a deliberately wrong total and a wrong quarter are caught.

### D3. `figure_without_data`

A caption with no list or table attached (after C5): the chart's values were not transcribed. On Nemotron this flagged the pie chart and the two heat maps it skipped.

---

## E. Not fixable in code (model limits)

- **Run-to-run variation (Gemini 3.5 Flash Lite).** On one run the model returned page 11 (the Table 4.2 continuation) as the raw PDF text instead of a table. On another it left the retest note unmarked. Code can't rebuild a table from plain text reliably. The prompt now asks for it explicitly, and a re-run usually gets it right.
- **`~` on printed chart labels.** One series of Figure 3.1 was still marked approximate despite the rule. The values themselves were correct.
- **Misread names on raster charts** (e.g. Kowalczyk on the org chart). The org-chart check reads the chart three ways and stores a reporting line only when they agree, which lowers the risk. It can't fix a misread name.
- **Same-depth unnumbered headings.** When the model writes "## Certifications" at the same depth as "## 4.2", it is left as a sibling, because the case is ambiguous.

**Documents ingested before these changes don't improve until they are re-ingested.**

---

## F. Porting checklist

1. Copy `table-repair.js` and `page-cleanup.js`. `page-cleanup.js` contains its own helpers (`clean`, `numberlessKey`, `hasPageCounter`, `isCandidate`, `trimEdges`).
2. In the extraction loop:
   - keep the PDF text per page (`texts[i]`) after the model output replaces `page.text`;
   - run the per-page steps in the order in section 0;
   - set `page.textLayer`;
   - run `trimPageOverlap`, then `removeRunningLines` with `{ textLayers }`.
3. Wrap every model call in the 429 retry (A1). Add per-provider batching (A2). Stop sending neighbour-page text (A3).
4. Add the prompt rules (A4) with generic examples only.
5. In the chunker:
   - `cutPoint` / `joinWith` / `shortCaption` (C1–C3);
   - the caption regex and italic stripping (C4);
   - `captionPlacement` + backward attach + the `searchText` prefix rule (C5);
   - heading fixes C6–C8 (check the regex backslashes);
   - table matching C9, forms C10, the "Row" label C11, cross-references C12;
   - `structure_warnings` D1–D3.
6. Copy `tests/extraction-checks.test.js` and adjust imports. Every test there was written from a real failure in the Vantara output.
7. Verify on a real document. Re-chunk a saved extraction offline first (no model calls); only then run the model again, because of the quota. Compare against the rendered page images, not against the model's own output.

### Shell gotcha when scripting edits

In this Windows Git Bash setup, backslashes inside `<<'EOF'` heredocs were collapsed before node saw them (`\\n` reached node as `\n`, and `\s` became `s`). Edit regex-heavy code with an editor or the Edit tool, not with shell-scripted string replacement. Afterwards, grep for patterns like `s*d+` to catch damage.


------------------next -------------------
