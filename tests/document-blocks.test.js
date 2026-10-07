import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLlamaParseResult,
  normalizeTextDocument,
} from "../src/services/extraction-normalizer.service.js";
import { buildDocumentSections } from "../src/services/document-sections.service.js";
import { collectDocumentBlocks } from "../src/services/document-blocks.service.js";

function pdf(...texts) {
  return normalizeLlamaParseResult(
    [{ pages: texts.map((md, index) => ({ page: index + 1, md })) }],
    { filename: "guide.pdf", mimetype: "application/pdf" },
  );
}

async function inspect(extraction) {
  const { sections } = await buildDocumentSections(extraction);
  return { sections, result: collectDocumentBlocks(extraction, sections) };
}

test("retains table labels, dates, units, escaped pipes and rows", async () => {
  const { result } = await inspect(pdf(
    "# 5. Population\n\n" +
    "| City | City proper — 31 December 2023 (people) |\n" +
    "| --- | ---: |\n| Kettleby | 163,482 |\n| A\\|B | 200 |",
  ));
  const table = result.blocks.find((block) => block.type === "table");
  assert.equal(table.table.header.cells[1].text,
    "City proper — 31 December 2023 (people)");
  assert.equal(table.table.rows[0].cells[1].text, "163,482");
  assert.equal(table.table.rows[1].cells[0].text, "A|B");
  assert.equal(table.table.rows.length, 2);
  assert.equal(table.sectionContext.ownershipStatus, "unresolved");
});

test("retains every list item and the actual source markers", async () => {
  const { result } = await inspect(pdf(
    "# 1. Activities\n\n1. First item.\n\n   More detail.\n\n" +
    "   - Nested item.\n\n3. Third-numbered item.",
  ));
  const list = result.blocks.find((block) => block.type === "list");
  assert.equal(list.list.items.length, 2);
  assert.equal(list.list.items[1].item.marker, "3.");
  assert.ok(list.list.items[0].rawText.includes("More detail."));
  assert.ok(list.list.items[0].item.blocks.some((block) => block.type === "list"));

  const many = await inspect(pdf("# 1. Events\n\n" +
    Array.from({ length: 19 }, (_, i) => (i + 1) + ". Event " + (i + 1)).join("\n")));
  assert.equal(many.result.blocks.find((block) => block.type === "list").list.items.length, 19);
});

test("top-level block locations cover original sources exactly", async () => {
  const extraction = pdf(
    "# 1. Examples\r\n\r\n🧭 Notes.\r\n\r\n````md\r\n# Hidden",
    "",
    "```\n# Still hidden\n````\n\nEnd.\n",
  );
  const { result } = await inspect(extraction);

  for (const page of extraction.pages) {
    const locations = result.blocks.flatMap((block) => block.locations)
      .filter((location) => location.sourceId === page.id);
    let cursor = 0;
    let text = "";
    for (const location of locations) {
      assert.equal(location.startOffset, cursor);
      text += page.text.slice(location.startOffset, location.endOffset);
      cursor = location.endOffset;
    }
    assert.equal(cursor, page.text.length);
    assert.equal(text, page.text);
  }
  const code = result.blocks.find((block) => block.type === "code");
  assert.equal(code.containsInsertedSeparators, true);
  assert.equal(code.locations.length, 2);
});

test("retains a headerless continuation without assigning semantic ownership", async () => {
  const { result } = await inspect(pdf(
    "# 5. Finance\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 70 |\n\n" +
    "# 6. Pallets\n\nPallet standards.",
    "| D08 | 80 |\n| D09 | 90 |",
  ));
  const fragment = result.blocks.find((block) => block.rawText.includes("D08"));
  assert.ok(fragment.warnings.includes("POSSIBLE_TABLE_FRAGMENT"));
  assert.equal(fragment.sectionContext.ownershipStatus, "unresolved");
  assert.equal(result.blocks.filter((block) => block.type === "table").length, 1);
});

test("retains HTML and plain text without inventing table structure", async () => {
  const html = await inspect(pdf(
    "<table>\n<tr><td>A</td><td>10</td></tr>\n</table>",
  ));
  assert.equal(html.result.blocks[0].type, "raw");
  assert.ok(html.result.blocks[0].warnings.includes("UNSUPPORTED_BLOCK_RETAINED"));

  const text = normalizeTextDocument(
    "TITLE\n\nordinary text\n\nDETAILS\n\nA | B",
    { filename: "notes.txt", mimetype: "text/plain" },
  );
  const plain = await inspect(text);
  assert.equal(plain.result.blocks.length, 1);
  assert.equal(plain.result.blocks[0].rawText, text.pages[0].text);
  assert.equal(plain.result.blocks[0].sectionContext.crossesSectionBoundary, true);
});

test("flags empty headers and malformed row widths without dropping raw text", async () => {
  const markdown = "| City | |\n| --- | --- |\n| A | 10 | EXTRA |\n| B |";
  const { result } = await inspect(pdf(markdown));
  const table = result.blocks.find((block) => block.type === "table");
  assert.ok(table.warnings.includes("EMPTY_COLUMN_LABEL"));
  assert.ok(table.warnings.includes("TABLE_ROW_WIDTH_MISMATCH"));
  assert.equal(table.rawText, markdown);
});

test("rejects section plans with stale text or incomplete source coverage", async () => {
  const extraction = pdf("# 1. Topic\n\nBody.");
  const { sections } = await buildDocumentSections(extraction);
  const stale = structuredClone(sections);
  stale[0].parts[0].text = "Changed";
  assert.throws(() => collectDocumentBlocks(extraction, stale), /does not match/);
  assert.throws(() => collectDocumentBlocks(extraction, []), /incomplete/);
});

test("does not modify extraction or section input", async () => {
  const extraction = pdf("| A | B |\n| --- | --- |\n| x | y |");
  const { sections } = await buildDocumentSections(extraction);
  const before = structuredClone({ extraction, sections });
  const result = collectDocumentBlocks(extraction, sections);
  result.blocks[0].locations[0].startOffset = 999;
  result.blocks[0].sectionContext.readingOrderSectionIds.length = 0;
  assert.deepEqual({ extraction, sections }, before);
});

test("flags grouping of lists across sources as unconfirmed", async () => {
  const { result } = await inspect(pdf(
    "# 1. Tasks\n\n1. First item.",
    "2. Second item.",
  ));
  const list = result.blocks.find((block) => block.type === "list");
  assert.equal(list.list.items.length, 2);
  assert.ok(list.warnings.includes("CROSS_SOURCE_LIST_GROUPING_UNCONFIRMED"));
});
