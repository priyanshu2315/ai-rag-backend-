import "./offline-embedding-setup.js";
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlamaParseResult, normalizeTextDocument } from "../src/services/extraction-normalizer.service.js";
import { buildDocumentChunks } from "../src/services/chunking.service.js";
import { measureEmbeddingInput } from "../src/services/embedding.service.js";
import { packStructuralUnits } from "../src/services/token-packer.service.js";

function pdf(...texts) {
  return normalizeLlamaParseResult(
    [{pages: texts.map((md, i) => ({page:i+1,md}))}],
    {filename:"handbook.pdf",mimetype:"application/pdf"},
  );
}
const build = (extraction, options) =>
  buildDocumentChunks(extraction,"document-1","handbook.pdf",()=>{},options);

test("splitting a short value with trailing whitespace always makes progress", async () => {
  const packed = await packStructuralUnits([{
    id: "short-unit", blockId: "short-block", text: "x ", labels: [],
    sectionId: null, groupId: "text", locations: [{ sourceId: "source-1" }],
  }], [], { title: "Example" }, "document-1", {
    // Model an over-budget value whose smaller pieces fit. Counts need not
    // be additive; the splitter must terminate independently of the tokenizer.
    measure: async (text) => ({
      tokenCount: text.endsWith("x ") ? 257 : 2, tokenLimit: 256,
    }),
  });
  assert.deepEqual(packed.flatMap((parent) => parent.pieces.map((piece) => piece.text)),
    ["x", " "]);
});

async function checkBudgets(parents) {
  for (const parent of parents) {
    assert.ok(parent.metadata.token_budget.tokenCount <= parent.metadata.token_budget.tokenLimit);
    for (const child of parent.children) {
      const count = await measureEmbeddingInput(child.searchText);
      assert.ok(count.withinLimit, child.searchText);
      assert.equal(count.tokenCount, child.metadata.token_budget.tokenCount);
      assert.ok(child.searchText.includes(child.text));
    }
  }
}

test("table values retain their distinct date and column labels in every child", async () => {
  const parents = await build(pdf(
    "# 1. Population\n\n| City | Census — 1 January 2022 | Metropolitan area — 31 December 2023 | City proper — 31 December 2023 |\n" +
    "| --- | --- | --- | --- |\n| Kettleby | 158,744 | 361,092 | 163,482 |",
  ));
  const children = parents.flatMap((parent) => parent.children);
  const row = children.find((child) => child.text.includes("163,482"));
  assert.ok(row.text.includes("City proper — 31 December 2023: 163,482"));
  assert.ok(row.text.includes("Census — 1 January 2022: 158,744"));
  assert.ok(row.text.includes("Metropolitan area — 31 December 2023: 361,092"));
  await checkBudgets(parents);
});

test("interrupted tables reconnect across pages and explicit definitions travel with values", async () => {
  const parents = await build(pdf(
    "# 5. Finance\n\n| Depot | B |\n| --- | --- |\n| D06 | 60 |\n| D07 | 70 |\n\n# 6. Pallets\n\nPallet standards.",
    "| D08 | 80 |\n| D09 | 90 |\n\n**5A. Column meanings**\n\n" +
    "This explains the column meanings in section 5.\n\nColumn B: Annual revenue (INR crore).",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Depot: D08"));
  assert.ok(row);
  assert.deepEqual(row.metadata.heading_path, ["5. Finance"]);
  assert.ok(row.text.includes("Annual revenue (INR crore)"));
  assert.ok(row.metadata.context_locations.some((loc) => loc.role === "column_definition"));
  assert.ok(row.metadata.relationships.some((item) => item.status === "inferred"));
  assert.ok(parents.some((parent) => parent.text.includes("Explanation for table:")));
  await checkBudgets(parents);
});

test("ambiguous continuation candidates are not silently joined", async () => {
  const parents = await build(pdf(
    "# 1. First\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 70 |\n\n" +
    "# 2. Second\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 99 |",
    "| D08 | 80 |\n| D09 | 90 |",
  ));
  const row = parents.find((parent) => parent.text.includes("D08"));
  assert.deepEqual(row.metadata.heading_path, []);
  assert.ok(row.searchText.includes("column meanings unavailable"));
  assert.ok(row.metadata.relationships.some((item) => item.reason === "AMBIGUOUS_TABLE_MATCH"));
});

test("a 19-item list stays in one parent when its parent budget permits", async () => {
  const parents = await build(pdf("# 1. Activities\n\n" +
    Array.from({length:19},(_,i)=>(i+1)+". Workshop activity "+(i+1)+".").join("\n")));
  const list = parents.filter((parent) => parent.metadata.list_item_ids.length);
  assert.equal(list.length, 1);
  assert.equal(list[0].metadata.list_item_ids.length, 19);
  for (const child of list[0].children) {
    assert.equal(child.metadata.contains_unit_fragments, false);
  }
  await checkBudgets(parents);
});

test("oversized rows split into labelled cells and long values retain row identity", async () => {
  const detail = "Long description. ".repeat(350);
  const parents = await build(pdf(
    "# 1. Records\n\n| ID | Description | Count |\n| --- | --- | --- |\n| R01 | " +
    detail + " | 42 |",
  ));
  const fragments = parents.flatMap((parent) => parent.children)
    .filter((child) => child.metadata.row_ids.length);
  assert.ok(fragments.length > 1);
  for (const child of fragments) assert.ok(child.text.includes("Row identity: ID: R01"));
  assert.ok(fragments.some((child) => child.text.includes("Count: 42")));
  assert.equal(fragments.map((child) => child.text).join("").match(/Long description\./g).length, 350);
  await checkBudgets(parents);
});

test("Unicode text is split without data loss and long context is compacted visibly", async () => {
  const text = "你好世界🧭 ".repeat(600);
  const extraction = normalizeTextDocument(text, {
    filename: "long filename ".repeat(200) + ".txt", mimetype:"text/plain",
  });
  const parents = await build(extraction);
  const rendered = parents.flatMap((parent) => parent.children).map((child) => child.text).join("");
  assert.equal(rendered.replace(/\s/g,""), text.replace(/\s/g,""));
  assert.ok(parents.every((parent) => parent.metadata.context_compacted));
  await checkBudgets(parents);
});

test("numbered sibling repair and unresolved headings survive integration", async () => {
  const parents = await build(pdf(
    "### 17. Equipment\n\nEquipment.\n\n#### 18. Safety\n\nSafety.\n\n**ACTIVITIES**\n\nWorkshops.",
  ));
  const safety = parents.find((parent) => parent.text.includes("Safety."));
  assert.deepEqual(safety.metadata.heading_path, ["18. Safety"]);
  const activities = parents.find((parent) => parent.text.includes("Workshops."));
  assert.deepEqual(activities.metadata.heading_path, []);
  assert.equal(activities.metadata.section_structure.review_required, true);
});

test("code fences and unsupported HTML remain source content", async () => {
  const parents = await build(pdf(
    "# 1. Examples\n\n````md\n# Hidden",
    "```\n# Still hidden\n````\n\n<table><tr><td>VALUE</td></tr></table>",
  ));
  assert.ok(parents.some((parent) => parent.text.includes("# Still hidden")));
  assert.ok(parents.some((parent) => parent.text.includes("<td>VALUE</td>")));
  assert.ok(parents.every((parent) => !parent.metadata.heading_path.some((title) => title.includes("Hidden"))));
  await checkBudgets(parents);
});

test("oversized mandatory column context produces a diagnostic instead of truncated values", async () => {
  const label = "important column meaning ".repeat(400);
  await assert.rejects(() => build(pdf(
    "# 1. Data\n\n| ID | " + label + " |\n| --- | --- |\n| X01 | 7 |",
  )), (error) => error.code === "CHUNK_CONTEXT_TOO_LARGE");
});

test("explicit references resolve uniquely; duplicate section labels remain ambiguous", async () => {
  const parents = await build(pdf(
    "# 1. First\n\nOne.\n\n# Chapter B\n\nText.\n\n## 1. Other\n\nOther.\n\n" +
    "# 2. Links\n\nSee section 1.",
  ));
  const refs = parents.flatMap((parent) => parent.metadata.references);
  assert.ok(refs.some((ref) => ref.targetLabel === "1" && ref.status === "unresolved"));
});

test("adjacent unit notes are repeated with table values", async () => {
  const parents = await build(pdf(
    "# 1. Rates\n\nUnits: INR crore, year ending 2025.\n\n" +
    "| Depot | Amount |\n| --- | --- |\n| D01 | 25 |",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Depot: D01"));
  assert.ok(row.text.includes("Units: INR crore, year ending 2025."));
});

test("chunk links remain within sections and output is JSON serializable", async () => {
  const parents = await build(pdf(
    "# 1. First\n\n" + "Alpha details. ".repeat(500) + "\n\n# 2. Next\n\nBeta.",
  ), {parentTokenLimit:400});
  const map = new Map(parents.map((parent) => [parent.id,parent]));
  for (const parent of parents) {
    if (parent.nextParentId) {
      const next = map.get(parent.nextParentId);
      assert.equal(next.prevParentId, parent.id);
      assert.equal(next.metadata.section_id, parent.metadata.section_id);
    }
  }
  assert.doesNotThrow(() => JSON.stringify(parents));
  await checkBudgets(parents);
});


test("cover identity survives changing section headings", async () => {
  const parents = await build(pdf(
    "# TESSALY PARCEL NETWORK\n\n## DEPOT HANDBOOK TPN-SH-2026-10",
    "### 17. Equipment\n\nDetails.\n\n#### 18. Safety\n\nSafety text.",
  ));
  const safety = parents.find((parent) => parent.text.includes("Safety text."));
  assert.equal(safety.metadata.document_identity.status, "inferred");
  assert.equal(safety.metadata.document_identity.titleSource, "opening_cover");
  assert.equal(safety.metadata.document_title,
    "TESSALY PARCEL NETWORK \u2014 DEPOT HANDBOOK TPN-SH-2026-10");
  assert.ok(safety.searchText.includes("DEPOT HANDBOOK TPN-SH-2026-10"));
  assert.deepEqual(safety.metadata.heading_path, ["18. Safety"]);
});

test("conflicting column definitions remain flagged rather than replacing labels", async () => {
  const parents = await build(pdf(
    "# 5. Rates\n\n| Depot | B |\n| --- | --- |\n| D01 | 50 |\n\n" +
    "## 5A. Key\n\nColumn meanings for section 5.\n\nColumn B: Revenue.\nColumn B: Population.",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Depot: D01"));
  assert.ok(row.metadata.structure_warnings.includes("CONFLICTING_COLUMN_DEFINITIONS"));
  assert.ok(row.text.includes("B: 50"));
  assert.ok(!row.text.includes("B — Revenue: 50"));
});

test("a continuation with incompatible value types stays unresolved", async () => {
  const parents = await build(pdf(
    "# 5. Rates\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 50 |",
    "| D08 | Open |\n| D09 | Closed |",
  ));
  const row = parents.find((parent) => parent.text.includes("D08"));
  assert.ok(row.searchText.includes("Unresolved table fragment"));
});

test("a note explaining two different tables is not assigned wholesale to either", async () => {
  const parents = await build(pdf(
    "# 1. First\n\n| ID | B |\n| --- | --- |\n| D01 | 10 |\n\n" +
    "# 2. Second\n\n| ID | B |\n| --- | --- |\n| E01 | 20 |\n\n" +
    "# 3. Meanings\n\nColumn meanings for section 1 and section 2.\n\nColumn B: Ambiguous meaning.",
  ));
  assert.ok(parents.flatMap((parent) => parent.metadata.references)
    .some((reference) => reference.reason === "MULTIPLE_EXPLANATION_TARGETS"));
  const first = parents.find((parent) => parent.text.includes("ID: D01"));
  assert.ok(!first.text.includes("B — Ambiguous meaning"));
});

test("nested table rows retain column labels and their list context", async () => {
  const parents = await build(pdf(
    "# 1. Tasks\n\n1. Check the following values.\n\n" +
    "   | Name | Count |\n   | --- | --- |\n   | Alpha | 42 |",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Name: Alpha"));
  assert.ok(row.text.includes("Item: 1."));
  assert.ok(row.text.includes("Count: 42"));
  await checkBudgets(parents);
});


test("headerless text values preserve literal backslashes", async () => {
  const parents = await build(pdf(
    "# 1. Paths\n\n| ID | Path |\n| --- | --- |\n| D07 | C:\\old |",
    "| D08 | C:\\data |\n| D09 | C:\\next |",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("ID: D08"));
  assert.ok(row.text.includes("C:\\data"));
});

test("generated children embed through the shared real model", async () => {
  const { getEmbedding } = await import("../src/services/embedding.service.js");
  const parents = await build(pdf("# 1. Facts\n\nA short source passage."));
  const vector = await getEmbedding(parents[0].children[0].searchText, {rejectTruncation:true});
  assert.equal(vector.length,384);
  assert.ok(Math.abs(Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0))-1)<0.0001);
});

test("budget failures are reported with a unit diagnostic", async () => {
  const events=[];
  await assert.rejects(() => buildDocumentChunks(
    pdf("# 1. Values\n\n| ID | "+ "long header ".repeat(600)+" |\n| --- | --- |\n| X01 | 4 |"),
    "document-1", "handbook.pdf", event=>events.push(event),
  ), error=>error.code==="CHUNK_CONTEXT_TOO_LARGE");
  assert.ok(events.some(event=>event.type==="chunking_failed" && event.details.unitId));
});
