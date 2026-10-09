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
  assert.equal(extraction.pageCount, 7);
  assert.equal(extraction.provider, "testvision");
  assert.equal(extraction.correction.provider, "testvision");
  assert.equal(extraction.correction.version, "ai-extraction-v1");
  assert.deepEqual(extraction.pages.map((page) => page.sourcePageNumber), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(events.some((event) => event.type === "testvision_extraction_batch_complete" && event.usage.promptTokenCount === 10));
  const parents = await buildDocumentChunks(extraction, "document-1", "source.pdf", () => {}, { measure });
  assert.ok(parents.some((parent) => parent.metadata.heading_path.includes("6. Process")));
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

