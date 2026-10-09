import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";
import { extractDocumentWithAI, buildDocumentChunks,
  measureEmbeddingInput, getEmbedding } from "../src/services/ai.service.js";

const source = (filename, mimetype) => ({ filename, mimetype });
const testAI = { model: "test-vision-model", providerName: "testvision" };
const extract = (buffer, inputSource, onEvent, options) =>
  extractDocumentWithAI(buffer, inputSource, onEvent, { ai: testAI, ...options });
const measure = async (text) => ({ tokenCount: Buffer.byteLength(text) + 2, tokenLimit: 256 });
const answer = (options, heading = "## 6. Process\n\n### Step 1\n\n") => {
  const input = JSON.parse(options.messages[1].content[0].text);
  const result = { documentTitle: "Source", continuationContext: "6. Process",
    pages: input.primarySourceIds.map((sourceId) => ({ sourceId,
      markdown: (sourceId === "source-1" ? "# Source\n\n" + heading : "") +
        "Original source " + sourceId })) };
  return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
};

test("PDF images are sent to the configured extraction model in ordered batches", async () => {
  const calls = [];
  const events = [];
  const extraction = await extract(tinyPDF(7), source("source.pdf", "application/pdf"),
    (event) => events.push(event), { request: async (options) => {
      const parts = options.messages[1].content;
      const input = JSON.parse(parts[0].text);
      calls.push(input);
      assert.ok(options.messages[0].content.includes("every informative figure"));
      assert.equal(parts.filter((part) => part.type === "image_url").length, input.sources.length);
      assert.equal(options.response_format.json_schema.schema.properties.pages.items.properties.sourceId.enum.length,
        input.primarySourceIds.length);
      return answer(options);
    } });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.primarySourceIds.length), [5, 2]);
  assert.deepEqual(calls[0].sources.map((item) => item.sourceId),
    ["source-1", "source-2", "source-3", "source-4", "source-5"]);
  assert.deepEqual(calls[1].sources.map((item) => item.sourceId),
    ["source-6", "source-7"]);
  assert.equal(calls[1].continuationContext, "6. Process");
  assert.equal(extraction.pageCount, 7);
  assert.equal(extraction.provider, "testvision");
  assert.equal(extraction.correction.provider, "testvision");
  assert.equal(extraction.correction.version, "ai-extraction-v1");
  assert.deepEqual(extraction.pages.map((page) => page.sourcePageNumber), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(events.some((event) => event.type === "testvision_extraction_batch_complete" && event.usage.promptTokenCount === 10));
  const parents = await buildDocumentChunks(extraction, "document-1", "source.pdf", () => {}, { measure });
  const sectionParents = parents.filter((parent) => parent.metadata.heading_path.includes("6. Process"));
  assert.deepEqual(sectionParents.map((parent) => parent.metadata.page_number), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(sectionParents.every((parent) => parent.metadata.source_pages.length === 1));
  assert.ok(sectionParents.every((parent) => parent.metadata.section_id === sectionParents[0].metadata.section_id));
  assert.equal(sectionParents[0].nextParentId, sectionParents[1].id);
  assert.equal(sectionParents[1].prevParentId, sectionParents[0].id);
  assert.ok(parents.every((parent) => parent.metadata.chunker_version === "ai-corrected-markdown-v3"));
  assert.ok(parents.every((parent) => parent.metadata.source_text === "ai_extracted_markdown"));
});

test("DOCX text and embedded images use the same extraction path", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body><w:p><w:r><w:t>Document text</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`);
  zip.file("word/media/image1.png", Buffer.from("89504e470d0a1a0a", "hex"));
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const extraction = await extract(buffer, source("source.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), () => {},
    { request: async (options) => {
      const parts = options.messages[1].content;
      const input = JSON.parse(parts[0].text);
      assert.match(input.sources[0].text, /Document text/);
      assert.match(input.sources[0].text, /Embedded image 1/);
      assert.match(parts.find((part) => part.type === "image_url")?.image_url.url,
        /^data:image\/png;base64,/);
      return answer(options);
    } });
  assert.equal(extraction.pages[0].sourcePageNumber, null);
  assert.equal(extraction.correction.visualInput, "docx_embedded_images");
});

test("plain text and images also go to the extraction model", async () => {
  for (const [buffer, type, expectedVisual] of [
    [Buffer.from("Hello from text"), "text/plain", "none"],
    [Buffer.from("image bytes"), "image/png", "original_image"],
  ]) {
    const extraction = await extract(buffer, source("source", type), () => {},
      { request: async (options) => {
        const parts = options.messages[1].content;
        const input = JSON.parse(parts[0].text);
        assert.equal(input.visualInput, expectedVisual);
        assert.equal(parts.some((part) => part.type === "image_url"), type === "image/png");
        return answer(options);
      } });
    assert.equal(extraction.pages.length, 1);
  }
});

test("model response must contain each primary source once", async () => {
  await assert.rejects(extract(Buffer.from("hello"), source("a.txt", "text/plain"),
    () => {}, { request: async () => ({ choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ documentTitle: "A", continuationContext: "", pages: [] }) } }] }) }),
  /invalid Markdown/);
});

test("extra top-level headings become sections", async () => {
  const extraction = await extract(Buffer.from("hello"), source("a.txt", "text/plain"),
    () => {}, { request: async (options) => ({ choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ documentTitle: "Source", continuationContext: "",
        pages: [{ sourceId: JSON.parse(options.messages[1].content[0].text).primarySourceIds[0],
          markdown: "# Company\n\n# Source\n\n## 1. Process" }] }) } }] }) });
  assert.match(extraction.pages[0].text, /^## Company\n\n# Source/m);
  assert.equal(extraction.documentTitle, "Source");
});

test("later PDF batches keep the first title and remove repeated title headings", async () => {
  const extraction = await extract(tinyPDF(6), source("source.pdf", "application/pdf"),
    () => {}, { request: async (options) => {
      const response = answer(options);
      const input = JSON.parse(options.messages[1].content[0].text);
      if (input.primarySourceIds.includes("source-6")) {
        const result = JSON.parse(response.choices[0].message.content);
        result.documentTitle = "9. Manager of Record";
        result.pages[0].markdown = "# Source\n\n# 9. Manager of Record\n\nManager details";
        response.choices[0].message.content = JSON.stringify(result);
      }
      return response;
    } });
  assert.equal(extraction.documentTitle, "Source");
  assert.equal(extraction.pages[5].text.trim(), "## 9. Manager of Record\n\nManager details");
});

test("a table at the start of the next page keeps its original section", async () => {
  const header = "| Depot Code | Depot Name | Column A — fiscal 2022 operating cost (K TC) | Column B — fiscal 2023 revenue (K TC) |";
  const rule = "| --- | --- | --- | --- |";
  const extraction = {
    schemaVersion: "extraction-v1", provider: "testvision", jobId: null,
    warnings: [], documentTitle: "Handbook",
    pages: [
      { id: "source-1", sequenceIndex: 0, sourceKind: "page", sourcePageNumber: 1,
        parserPageNumber: null, textFormat: "markdown", warnings: [],
        text: "# Handbook\n\n## 5. Financial record\n\n" + header + "\n" + rule +
          "\n| D01 | First Depot | 3,880 | 6,410 |\n\n## 6. Pallet standards\n\nPallet rules." },
      { id: "source-2", sequenceIndex: 1, sourceKind: "page", sourcePageNumber: 2,
        parserPageNumber: null, textFormat: "markdown", warnings: [],
        text: header + "\n" + rule + "\n| D12 | Last Depot | 5,161 | 9,990 |" +
          "\n\n## 5A. Column key\n\nA and B are financial columns." },
    ],
  };
  const parents = await buildDocumentChunks(extraction, "document-1", "handbook.pdf",
    () => {}, { measure: async (text) => ({ tokenCount: Math.ceil(text.length / 5), tokenLimit: 256 }) });
  const firstRow = parents.find((parent) => parent.text.includes("First Depot"));
  const lastRow = parents.find((parent) => parent.text.includes("Last Depot"));
  const pallet = parents.find((parent) => parent.text.includes("Pallet rules"));
  assert.deepEqual(firstRow.metadata.heading_path, ["5. Financial record"]);
  assert.deepEqual(lastRow.metadata.heading_path, ["5. Financial record"]);
  assert.equal(lastRow.metadata.section_id, firstRow.metadata.section_id);
  assert.equal(firstRow.nextParentId, null);
  assert.equal(lastRow.prevParentId, null);
  assert.deepEqual(firstRow.metadata.linked_table_ids, lastRow.metadata.linked_table_ids);
  assert.equal(lastRow.metadata.relationships[0].type, "table_continuation");
  assert.notEqual(pallet.metadata.section_id, lastRow.metadata.section_id);
  assert.match(lastRow.text, /fiscal 2022 operating cost \(K TC\): 5,161/);
  assert.match(lastRow.text, /fiscal 2023 revenue \(K TC\): 9,990/);
});

test("interrupted financial rows keep their table and section across a different header", async () => {
  const page = (number, text) => ({
    id: "source-" + number, sequenceIndex: number - 1,
    sourceKind: "page", sourcePageNumber: number, parserPageNumber: null,
    textFormat: "markdown", warnings: [], text,
  });
  const longHeader = "| Depot Code | Depot Name | Column A — fiscal 2022 cost (K TC) | Column B — fiscal 2023 revenue (K TC) | Column C — fiscal 2023 cost (K TC) |";
  const shortHeader = "| Depot Code | Depot Name | Column A | Column B | Column C |";
  const rule = "| --- | --- | --- | --- | --- |";
  const extraction = {
    schemaVersion: "extraction-v1", provider: "testvision", jobId: null,
    warnings: [], documentTitle: "Handbook", pages: [
      page(1, "# Handbook\n\n## 5. Financial record"),
      page(2, "## 5. Financial record\n\n" + longHeader + "\n" + rule +
        "\n| D01 | First Depot | 3,880 | 6,410 | 3,905 |\n| D02 | Second Depot | 3,912 | 6,102 | 3,931 |" +
        "\n\n## 6. Pallet standards\n\nPallet rules."),
      page(3, shortHeader + "\n" + rule +
        "\n| D03 | Third Depot | 3,934 | 7,020 | 3,899 |" +
        "\n\n## 5A. Column key\n\nA, B and C describe the financial table."),
    ],
  };
  const parents = await buildDocumentChunks(extraction, "document-1", "handbook.pdf",
    () => {}, { measure: async (text) => ({ tokenCount: Math.ceil(text.length / 5), tokenLimit: 256 }) });
  const heading = parents.find((parent) => parent.metadata.page_number === 1 && parent.text.includes("Financial record"));
  const first = parents.find((parent) => parent.text.includes("First Depot"));
  const resumed = parents.find((parent) => parent.text.includes("Third Depot"));
  const pallets = parents.find((parent) => parent.text.includes("Pallet rules"));
  assert.equal(first.metadata.section_id, heading.metadata.section_id);
  assert.equal(heading.nextParentId, first.id);
  assert.equal(first.prevParentId, heading.id);
  assert.equal(resumed.metadata.section_id, first.metadata.section_id);
  assert.deepEqual(resumed.metadata.heading_path, ["5. Financial record"]);
  assert.equal(resumed.metadata.page_number, 3);
  assert.doesNotMatch(resumed.text, /## 5\. Financial record/);
  assert.match(resumed.text, /Column A — fiscal 2022 cost \(K TC\): 3,934/);
  assert.deepEqual(resumed.metadata.linked_table_ids, first.metadata.linked_table_ids);
  assert.equal(resumed.metadata.relationships[0].match, "row_sequence");
  assert.equal(first.nextParentId, null);
  assert.equal(resumed.prevParentId, null);
  assert.notEqual(pallets.metadata.section_id, resumed.metadata.section_id);
  assert.deepEqual(pallets.metadata.linked_table_ids, []);
});

test("unrelated table rows are not reassigned to an earlier section", async () => {
  const table = (header, row) => header + "\n| --- | --- | --- |\n" + row;
  const extraction = {
    documentTitle: "Handbook", pages: [
      { id: "source-1", sequenceIndex: 0, sourceKind: "page", sourcePageNumber: 1,
        textFormat: "markdown", warnings: [],
        text: "# Handbook\n\n## 5. Costs\n\n" +
          table("| Depot Code | Name | Cost |", "| D01 | First | 100 |") +
          "\n\n## 6. Assets\n\nAsset rules." },
      { id: "source-2", sequenceIndex: 1, sourceKind: "page", sourcePageNumber: 2,
        textFormat: "markdown", warnings: [],
        text: table("| Asset Code | Name | Value |", "| D02 | Forklift | 200 |") },
    ],
  };
  const parents = await buildDocumentChunks(extraction, "document-1", "handbook.pdf",
    () => {}, { measure: async (text) => ({ tokenCount: Math.ceil(text.length / 5), tokenLimit: 256 }) });
  const assets = parents.find((parent) => parent.text.includes("Forklift"));
  const rules = parents.find((parent) => parent.text.includes("Asset rules"));
  assert.equal(assets.metadata.section_id, rules.metadata.section_id);
  assert.deepEqual(assets.metadata.linked_table_ids, []);
  assert.deepEqual(assets.metadata.relationships, []);
});

test("the local tokenizer keeps child embeddings within the model limit", async () => {
  const extraction = await extract(Buffer.from("hello"), source("a.txt", "text/plain"),
    () => {}, { request: async (options) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      documentTitle: "Source", continuationContext: "",
      pages: [{ sourceId: JSON.parse(options.messages[1].content[0].text).primarySourceIds[0],
        markdown: "# Source\n\n## 6. Process\n\n### Step 1\n\n" +
          "Document the concern and date. ".repeat(90) }],
    }) } }] }) });
  const parents = await buildDocumentChunks(extraction, "document-1", "a.txt");
  const children = parents.flatMap((parent) => parent.children);
  assert.ok(children.length > 1);
  for (const child of children) assert.ok((await measureEmbeddingInput(child.searchText)).withinLimit);
  const vector = await getEmbedding(children[0].searchText, { rejectTruncation: true });
  assert.equal(vector.length, 384);
});

test("PDF digital text is extracted and passed into sources", async () => {
  let passedSources = [];
  await extract(tinyPDF(1), source("sample.pdf", "application/pdf"), () => {}, {
    request: async (options) => {
      const input = JSON.parse(options.messages[1].content[0].text);
      passedSources = input.sources;
      return answer(options);
    },
  });
  assert.equal(passedSources.length, 1);
  assert.equal(passedSources[0].text, "Original source");
});

test("child searchText does not repeat section header for each row", async () => {
  const extraction = {
    schemaVersion: "extraction-v1",
    provider: "testvision",
    jobId: null,
    warnings: [],
    documentTitle: "Handbook",
    pages: [
      {
        id: "source-1",
        sequenceIndex: 0,
        sourceKind: "page",
        sourcePageNumber: 1,
        parserPageNumber: null,
        textFormat: "markdown",
        warnings: [],
        text: "## 5. Financial record\n\n| Depot | Cost |\n| --- | --- |\n| D01 | 100 |\n| D02 | 200 |\n| D03 | 300 |",
      },
    ],
  };
  const parents = await buildDocumentChunks(extraction, "document-1", "handbook.pdf", () => {}, {
    measure: async (text) => ({ tokenCount: Math.ceil(text.length / 5), tokenLimit: 256 }),
  });
  const child = parents[0].children[0];
  const sectionOccurrences = (child.searchText.match(/Section: 5\. Financial record/g) || []).length;
  assert.equal(sectionOccurrences, 1);
});

test("section continuation strips (continued) suffix and links interrupted table rows across pages", async () => {
  const extraction = {
    schemaVersion: "extraction-v1",
    provider: "testvision",
    jobId: null,
    warnings: [],
    documentTitle: "DEPOT HANDBOOK TPN-SH-2026-10",
    pages: [
      {
        id: "source-2",
        sequenceIndex: 1,
        sourceKind: "page",
        sourcePageNumber: 2,
        parserPageNumber: null,
        textFormat: "markdown",
        warnings: [],
        text: "## 5. DEPOT FINANCIAL RECORD, FISCAL 2022 AND FISCAL 2023 (K TC, final; complete set of all twelve depots)",
      },
      {
        id: "source-3",
        sequenceIndex: 2,
        sourceKind: "page",
        sourcePageNumber: 3,
        parserPageNumber: null,
        textFormat: "markdown",
        warnings: [],
        text: `## 5. DEPOT FINANCIAL RECORD, FISCAL 2022 AND FISCAL 2023 (K TC, final; complete set of all twelve depots) (continued)

| Depot Code and Name | Column A — fiscal 2022 operating cost (K TC) | Column B — fiscal 2023 revenue (K TC) | Column C — fiscal 2023 operating cost (K TC) |
| --- | --- | --- | --- |
| D01 Alderbank Yard | 3,880 | 6,410 | 3,905 |
| D02 Alderbank Yard North | 3,912 | 6,102 | 3,931 |
| D03 Alderbrook Yard | 3,934 | 7,020 | 3,899 |
| D04 Marrowgate Depot | 4,515 | 8,260 | 4,488 |
| D05 Marrowgate Depot South | 4,498 | 8,905 | 5,127 |
| D06 Marrow Gate Terminal | 4,560 | 7,745 | 4,552 |
| D07 Tollwick Hub | 3,205 | 5,980 | 3,230 |

## 6. PALLET AND LOAD UNIT STANDARDS

Standard pallets measure 1,200 mm by 1,000 mm.`,
      },
      {
        id: "source-4",
        sequenceIndex: 3,
        sourceKind: "page",
        sourcePageNumber: 4,
        parserPageNumber: null,
        textFormat: "markdown",
        warnings: [],
        text: `## 5. DEPOT FINANCIAL RECORD, FISCAL 2022 AND FISCAL 2023 (K TC, final; complete set of all twelve depots) (continued)

| Depot Code and Name | Column A | Column B | Column C |
| --- | --- | --- | --- |
| D08 Tollwick Hub II | 3,198 | 5,512 | 3,244 |
| D09 Stanehall Store | 4,950 | 9,310 | 4,967 |
| D10 Stanehall Store West | 4,982 | 9,845 | 5,010 |
| D11 Stanehall Annex | 5,015 | 8,120 | 5,044 |
| D12 Staneholm Depot | 5,161 | 9,990 | 5,119 |

## 5A. COLUMN KEY FOR THE TABLE IN SECTION 5

Column key notes.`,
      },
    ],
  };

  const parents = await buildDocumentChunks(
    extraction,
    "doc-1",
    "Chunking_Stress_Test_Document.pdf",
    () => {},
    { measure: async (text) => ({ tokenCount: Math.ceil(text.length / 5), tokenLimit: 256 }) },
  );

  const sec5Page2 = parents.find((p) => p.metadata.page_number === 2 && p.text.includes("DEPOT FINANCIAL RECORD"));
  const sec5Page3 = parents.find((p) => p.metadata.page_number === 3 && p.text.includes("Alderbank Yard"));
  const palletSec = parents.find((p) => p.metadata.page_number === 3 && p.text.includes("PALLET"));
  const sec5Page4 = parents.find((p) => p.metadata.page_number === 4 && p.text.includes("Tollwick Hub II"));

  assert.ok(sec5Page2 && sec5Page3 && palletSec && sec5Page4);
  assert.equal(sec5Page3.metadata.section_id, sec5Page2.metadata.section_id);
  assert.equal(sec5Page4.metadata.section_id, sec5Page2.metadata.section_id);
  assert.notEqual(palletSec.metadata.section_id, sec5Page2.metadata.section_id);

  assert.doesNotMatch(sec5Page3.text, /\(continued\)/i);
  assert.doesNotMatch(sec5Page4.text, /\(continued\)/i);
  assert.doesNotMatch(sec5Page3.searchText, /\(continued\)/i);
  assert.doesNotMatch(sec5Page4.searchText, /\(continued\)/i);

  assert.deepEqual(sec5Page3.metadata.table_ids, ["table-1"]);
  assert.deepEqual(sec5Page4.metadata.table_ids, ["table-1"]);
  assert.deepEqual(sec5Page4.metadata.linked_table_ids, ["table-1"]);
  assert.equal(sec5Page4.metadata.relationships.length, 1);
  assert.equal(sec5Page4.metadata.relationships[0].type, "table_continuation");
  assert.equal(sec5Page4.metadata.relationships[0].match, "row_sequence");

  assert.match(sec5Page4.text, /Column A — fiscal 2022 operating cost \(K TC\): 3,198/);
  assert.match(sec5Page4.text, /Column B — fiscal 2023 revenue \(K TC\): 9,990/);
});

function tinyPDF(pageCount = 1) {
  const content = "BT /F1 18 Tf 40 180 Td (Original source) Tj ET";
  const fontId = pageCount + 3;
  const contentId = pageCount + 4;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [" + Array.from({ length: pageCount }, (_, index) => (index + 3) + " 0 R").join(" ") + "] /Count " + pageCount + " >>",
    ...Array.from({ length: pageCount }, () =>
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 220] /Resources << /Font << /F1 " + fontId + " 0 R >> >> /Contents " + contentId + " 0 R >>"),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream",
  ];
  let data = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(data.length);
    data += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
  }
  const xref = data.length;
  data += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n" + offsets.map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("");
  data += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF";
  return Buffer.from(data);
}

