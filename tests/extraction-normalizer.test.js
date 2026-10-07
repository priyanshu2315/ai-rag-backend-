import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeLlamaParseResult,
  normalizeTextDocument,
} from "../src/services/extraction-normalizer.service.js";

const pdfSource = {
  filename: "handbook.pdf",
  mimetype: "application/pdf",
};

function parse(pages, extra = {}) {
  return normalizeLlamaParseResult(
    [{ ...extra, pages }],
    pdfSource,
  );
}

test("keeps blank pages and the original PDF page numbers", () => {
  const result = parse([
    { page: 4, md: "# Heading" },
    { page: 5, md: "" },
    { page: 6, md: "Later content" },
  ]);

  assert.deepEqual(
    result.pages.map((page) => page.sourcePageNumber),
    [4, 5, 6],
  );

  assert.equal(result.pages[1].text, "");

  assert.ok(
    result.pages[1].warnings.includes("EMPTY_EXTRACTED_TEXT"),
  );
});

test("does not invent a missing page number or missing parser items", () => {
  const page = parse([{ md: "Content" }]).pages[0];

  assert.equal(page.sourcePageNumber, null);
  assert.equal(page.items, null);

  assert.ok(
    page.warnings.includes("PAGE_NUMBER_UNAVAILABLE"),
  );
});

test("keeps normalized items separate from the raw response", () => {
  const pages = [
    {
      page: 1,
      md: "| City | Population |",
      items: [
        {
          type: "table",
          rows: [["City", "Population"]],
        },
      ],
    },
  ];

  const result = parse(pages);

  result.pages[0].items[0].rows[0][0] = "Changed";

  assert.equal(
    result.rawResult.pages[0].items[0].rows[0][0],
    "City",
  );

  assert.equal(
    pages[0].items[0].rows[0][0],
    "City",
  );
});

test("rejects invalid, duplicate, and reversed page numbers", () => {
  assert.throws(
    () => parse([{ page: 0, md: "A" }]),
    /invalid/,
  );

  assert.throws(
    () =>
      parse([
        { page: 1, md: "A" },
        { page: 1, md: "B" },
      ]),
    /duplicate/,
  );

  assert.throws(
    () =>
      parse([
        { page: 2, md: "A" },
        { page: 1, md: "B" },
      ]),
    /out of order/,
  );
});

test("distinguishes parser failures and malformed output from blank text", () => {
  assert.throws(
    () => parse([{ success: false, md: "A" }]),
    /failure/,
  );

  assert.throws(
    () => parse([{ page: 1 }]),
    /neither Markdown nor text/,
  );

  assert.throws(
    () => parse([{ md: 42 }]),
    /must be a string/,
  );

  assert.throws(
    () => parse([{ md: "A", items: {} }]),
    /items must be an array/,
  );

  assert.throws(
    () => parse([{ md: "" }]),
    /no extracted text/,
  );
});

test("preserves original whitespace and reports a plain-text fallback", () => {
  const page = parse([
    {
      page: 1,
      md: "",
      text: "  Text\r\n",
    },
  ]).pages[0];

  assert.equal(page.text, "  Text\r\n");
  assert.equal(page.textFormat, "plain");

  assert.ok(
    page.warnings.includes("PLAIN_TEXT_FALLBACK"),
  );
});

test("records a mismatch between reported and returned page counts", () => {
  const result = parse(
    [{ page: 1, md: "Content" }],
    { job_metadata: { job_pages: 2 } },
  );

  assert.ok(
    result.warnings.includes("REPORTED_PAGE_COUNT_MISMATCH"),
  );
});

test("distinguishes a DOCX rendered page from a PDF source page", () => {
  const result = normalizeLlamaParseResult(
    [{ pages: [{ page: 2, md: "Content" }] }],
    {
      filename: "guide.docx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  );

  assert.equal(
    result.pages[0].sourceKind,
    "rendered_page",
  );

  assert.equal(result.pages[0].parserPageNumber, 2);
  assert.equal(result.pages[0].sourcePageNumber, null);
});

test("represents Markdown as a document without physical page numbers", () => {
  const result = normalizeTextDocument(
    "# Notes\n\nText",
    {
      filename: "notes.md",
      mimetype: "text/markdown",
    },
  );

  assert.equal(result.pages[0].sourceKind, "document");
  assert.equal(result.pages[0].sourcePageNumber, null);
  assert.equal(result.pages[0].textFormat, "markdown");
});