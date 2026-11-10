import assert from "node:assert/strict";
import { test } from "node:test";
import { repairMarkdownTables } from "../src/utils/table-repair.js";
import { rateLimitWaitMs, withRateLimitRetry } from "../src/utils/rate-limit.js";
import { buildDocumentChunks, cutPoint, extractCrossReferences } from "../src/services/simple-chunking.service.js";

const measure = async (text) => ({ tokenCount: Math.ceil(text.length / 4), tokenLimit: 256 });
const page = (number, text) => ({
  id: "source-" + number, sequenceIndex: number - 1, sourceKind: "page", sourcePageNumber: number,
  parserPageNumber: null, textFormat: "markdown", warnings: [], text,
});
const chunk = (pages, extra = {}, options = {}) =>
  buildDocumentChunks({ documentTitle: "Report", pages, pageCount: pages.length, ...extra }, "doc", "report.pdf", () => {}, { measure, ...options });

// ---------- Rate limits ----------

test("a per-minute 429 waits the stated delay; a daily quota or another error does not retry", () => {
  assert.equal(rateLimitWaitMs({ status: 429, message: "Quota exceeded. Please retry in 54.9s." }), 55_900);
  assert.equal(rateLimitWaitMs({ status: 429, message: "x", headers: { "retry-after": "10" } }), 11_000);
  assert.equal(rateLimitWaitMs({ status: 429, message: "x" }), 61_000, "no stated delay waits 60 s");
  assert.equal(rateLimitWaitMs({ status: 429, message: "retry in 900s" }), 120_000, "a wait is capped at 2 minutes");
  assert.equal(rateLimitWaitMs({ status: 429, message: "GenerateRequestsPerDayPerProjectPerModel" }), null);
  assert.equal(rateLimitWaitMs({ status: 500, message: "server error" }), null);
});

test("a rate-limited request is retried and a non-rate-limit error is thrown at once", async () => {
  let calls = 0;
  const waits = [];
  const result = await withRateLimitRetry(async () => {
    calls++;
    if (calls < 3) throw { status: 429, message: "retry in 0s" };
    return "ok";
  }, ({ attempt, waitMs }) => waits.push([attempt, waitMs]));
  assert.equal(result, "ok");
  assert.deepEqual(waits, [[1, 1000], [2, 1000]]);
  await assert.rejects(withRateLimitRetry(async () => { throw new Error("bad request"); }), /bad request/);
});

// ---------- Table repair ----------

test("a table with two heading rows and a misplaced delimiter gets one heading row", () => {
  const text = [
    "| Vendor | Contract | | Service level | Notes |",
    "| | Start | End | Uptime (%) | |",
    "|---|---|---|---|---|",
    "| VEN-001 | 2025-01-01 | 2026-12-31 | 99.5 | Renewal due |",
  ].join("\n");
  const { text: fixed, repaired } = repairMarkdownTables(text);
  assert.equal(repaired.length, 1);
  assert.deepEqual(fixed.split("\n"), [
    "| Vendor | Start | End | Uptime (%) | Notes |",
    "|---|---|---|---|---|",
    "| VEN-001 | 2025-01-01 | 2026-12-31 | 99.5 | Renewal due |",
  ]);
  const good = "| A | B |\n|---|---|\n| 1 | 2 |";
  assert.deepEqual(repairMarkdownTables(good), { text: good, repaired: [], joinedRows: 0, separated: 0 });
});

test("a table row whose cells were copied over several lines is joined back into one row", () => {
  const text = [
    "| Code | Name | Annual value",
    "(USD) | Owner |",
    "|---|---|---|---|",
    "| P-1 | Main site | 4.0 | Operations",
    "team |",
  ].join("\n");
  const { text: fixed, joinedRows } = repairMarkdownTables(text);
  assert.equal(joinedRows, 2);
  assert.deepEqual(fixed.split("\n"), [
    "| Code | Name | Annual value (USD) | Owner |",
    "|---|---|---|---|",
    "| P-1 | Main site | 4.0 | Operations team |",
  ]);
});

test("a delimiter row with a stray empty cell still marks the heading row", () => {
  const text = "| Item | Qty | Owner |\n| --- | --- | --- | |\n| Laptop | 2 | IT |\n| Desk | 1 | Facilities |";
  assert.deepEqual(repairMarkdownTables(text).text.split("\n"), [
    "| Item | Qty | Owner |", "|---|---|---|", "| Laptop | 2 | IT |", "| Desk | 1 | Facilities |",
  ]);
});

test("a headerless table that starts with a title row gets its column names as the heading", () => {
  const text = "| TEST RESULTS | | | |\n| # | Check | Measured | Result |\n| 1 | Capacity | 503.7 | Pass |";
  assert.deepEqual(repairMarkdownTables(text).text.split("\n"), [
    "**TEST RESULTS**", "", "| # | Check | Measured | Result |", "|---|---|---|---|", "| 1 | Capacity | 503.7 | Pass |",
  ]);
});

test("two tables written as one run, or a line glued under a table, are separated", () => {
  const text = [
    "| Item | Qty |", "|---|---|", "| Gloves | 1 set |", "| Masks | 2 sets |",
    "| Table 2 – Optional spares | |",
    "| Item | Qty | Price |", "| --- | --- | --- |", "| Filter | 1 | 4.97 |",
  ].join("\n");
  assert.deepEqual(repairMarkdownTables(text).text.split("\n"), [
    "| Item | Qty |", "|---|---|", "| Gloves | 1 set |", "| Masks | 2 sets |",
    "", "**Table 2 – Optional spares**", "",
    "| Item | Qty | Price |", "| --- | --- | --- |", "| Filter | 1 | 4.97 |",
  ]);
  const glued = repairMarkdownTables("| A | B |\n|---|---|\n| 1 | 2 |\nThe next paragraph.");
  assert.equal(glued.text, "| A | B |\n|---|---|\n| 1 | 2 |\n\nThe next paragraph.");
  assert.equal(glued.separated, 1);
});

// ---------- References ----------

test("codes are kept whole, including long and multi-part ones", () => {
  assert.deepEqual(
    extractCrossReferences("PO-10234 for VEN-014 under INC-2025-014; see R-04, PP-FT-01 and PKG-PL-02. " +
      "Dual-fuel, Low-NOx and 3-pass are not codes."),
    ["PO-10234", "VEN-014", "INC-2025-014", "R-04", "PP-FT-01", "PKG-PL-02"],
  );
});

test("words after 'appendix' are not references; lists and ranges are expanded", () => {
  assert.deepEqual(extractCrossReferences("If an appendix and the body disagree, the appendix prevails."), []);
  assert.deepEqual(extractCrossReferences("## APPENDIX AND NOTES"), []);
  assert.deepEqual(extractCrossReferences("Appendices B, C and D are attached."), ["Appendix B", "Appendix C", "Appendix D"]);
  assert.deepEqual(extractCrossReferences("See Figures 3.1 to 3.4."), ["Figure 3.1", "Figure 3.2", "Figure 3.3", "Figure 3.4"]);
  assert.deepEqual(extractCrossReferences("Sections 1 and 3; Figure 4.4b"), ["Figure 4.4b", "§1", "§3"]);
});

test("only a numbered or coded resolution is a reference", () => {
  assert.deepEqual(extractCrossReferences("Tier 1 resolution within the Resolution SLA; prior resolution attempts; Resolution Memo."), []);
  assert.deepEqual(
    extractCrossReferences("Approved by Resolution 2025-14, Resolution No. 7 and Resolution BR-12."),
    ["Resolution 2025-14", "Resolution 7", "Resolution BR-12", "BR-12"],
  );
});

test("references are saved on the chunk that mentions them", async () => {
  const parents = await chunk([page(1, "## 1 Purchasing\n\nPurchase order PO-10234 follows Clause 4.2 and Appendix B.")]);
  assert.deepEqual(parents[0].metadata.references, ["§4.2", "Appendix B", "PO-10234"]);
  assert.deepEqual(parents[0].children[0].metadata.references, ["§4.2", "Appendix B", "PO-10234"]);
});

// ---------- Cutting long text ----------

test("long text is cut at a line break, else at a sentence end", () => {
  const lines = Array.from("- one item\n- two item\n- three item");
  assert.equal(lines.slice(0, cutPoint(lines).index).join(""), "- one item\n- two item");
  assert.equal(cutPoint(lines).separator, "\n");
  const sentence = Array.from("The first sentence ends here. The second sentence is here.");
  assert.equal(sentence.slice(0, cutPoint(sentence).index).join(""), "The first sentence ends here.");
});

test("a long paragraph is split without adding a paragraph break inside it", async () => {
  const sentences = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} explains one rule of the policy.`).join(" ");
  const parents = await chunk([page(1, "## 1 Policy\n\n" + sentences)]);
  assert.ok(parents[0].children.length > 1, "the paragraph needs more than one child");
  assert.equal(parents[0].text, "## 1 Policy\n\n" + sentences, "the parent text is the page as written");
});

// ---------- Table rows ----------

test("a blank top-left heading cell is labelled Row, not Column 1", async () => {
  const parents = await chunk([page(1, "## 2 Results\n\n| | FY2024 | FY2025 |\n|---|---|---|\n| Revenue | 410 | 455 |")]);
  assert.match(parents[0].text, /^Row: Revenue\nFY2024: 410\nFY2025: 455$/m);
});

test("a row too long for one snippet is split into groups of whole fields that name the row", async () => {
  const labels = Array.from({ length: 12 }, (_, i) => "Field " + (i + 1));
  const values = labels.map((label, i) => (i === 0 ? "VEN-014" : "value " + i + " " + "x".repeat(120)));
  const table = "| " + labels.join(" | ") + " |\n|" + labels.map(() => "---").join("|") + "|\n| " + values.join(" | ") + " |";
  const parents = await chunk([page(1, "## 3 Vendors\n\n" + table)]);
  const children = parents.flatMap((parent) => parent.children);
  assert.ok(children.length > 1);
  // The first child also carries the "## 3 Vendors" heading block before the row.
  const rowParts = children.map((child) => child.text.slice(child.text.indexOf("Row identity:")));
  for (const part of rowParts) {
    assert.match(part, /^Row identity: Field 1: VEN-014\n/);
    // every field in a child is whole: "Field N: value N xxx…"
    for (const line of part.split("\n").slice(1)) assert.match(line, /^Field \d+: value \d+ x{120}$/);
  }
  const fieldsSeen = rowParts.flatMap((part) => part.split("\n").slice(1)).length;
  assert.equal(fieldsSeen, 11, "every field except the identity appears exactly once");
});

// ---------- Appendices ----------

test("a second appendix starting on the same page gets its own section", async () => {
  const documentOutline = [
    { sectionCode: "", title: "Annexure E – Valve Schedule", targetPage: 2, pageCount: null },
    { sectionCode: "", title: "Annexure F – Data Required from Customer", targetPage: 2, pageCount: null },
  ];
  const parents = await chunk([
    page(1, "## Annexure D – Instrument Schedule\n\nTag list."),
    page(2, [
      "## Annexure E – Valve Schedule", "",
      "| Tag | Service |\n|---|---|\n| V-201 | Main steam stop valve |", "",
      "## Annexure F – Data Required from Customer", "",
      "| No. | Data / input |\n|---|---|\n| 1 | Final fuel analysis |",
    ].join("\n")),
  ], { documentOutline });
  const paths = parents.map((parent) => [parent.metadata.heading_path.join(" > "), parent.text.split("\n").at(-1)]);
  assert.deepEqual(paths.slice(-2), [
    ["Annexure E – Valve Schedule", "Service: Main steam stop valve"],
    ["Annexure F – Data Required from Customer", "Data / input: Final fuel analysis"],
  ]);
});

test("an appendix title printed again as a heading does not double the section path", async () => {
  const documentOutline = [{ sectionCode: "Appendix A", title: "Glossary", targetPage: 2, pageCount: null }];
  const parents = await chunk([
    page(1, "## 1 Introduction\n\nBody."),
    page(2, "## A Appendix A - Glossary\n\n| Term | Meaning |\n|---|---|\n| SLA | Service level agreement |"),
  ], { documentOutline });
  assert.deepEqual(parents.at(-1).metadata.heading_path, ["Appendix A - Glossary"]);
});
