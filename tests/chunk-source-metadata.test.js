import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeLlamaParseResult,
  normalizeTextDocument,
} from "../src/services/extraction-normalizer.service.js";

import {
  buildDocumentChunks,
} from "../src/services/chunking.service.js";

test("preserves PDF source pages across blank entries", async () => {
  const extraction = normalizeLlamaParseResult(
    [
      {
        job_id: "parser-job-1",
        pages: [
          {
            page: 4,
            md: "# Topic\n\nFirst source passage.",
          },
          {
            page: 5,
            md: "",
          },
          {
            page: 9,
            md: "Second source passage.",
          },
        ],
      },
    ],
    {
      filename: "handbook.pdf",
      mimetype: "application/pdf",
    },
  );

  const events = [];

  const parents = await buildDocumentChunks(
    extraction,
    "document-1",
    "handbook.pdf",
    (event) => events.push(event),
  );

  assert.deepEqual(
    parents.map((parent) => parent.metadata.page_number),
    [4, 9],
  );

  assert.deepEqual(
    parents.map((parent) => parent.metadata.source.id),
    ["source-1", "source-3"],
  );

  assert.deepEqual(
    parents.map((parent) => parent.metadata.source_pages),
    [[4], [9]],
  );

  for (const parent of parents) {
    for (const child of parent.children) {
      assert.deepEqual(
        child.metadata.source,
        parent.metadata.source,
      );

      assert.equal(
        child.metadata.extraction.job_id,
        "parser-job-1",
      );
    }
  }

  const start = events.find(
    (event) => event.type === "chunking_start",
  );

  assert.equal(start.totalSources, 3);
  assert.equal(start.totalPages, null);
});

test("keeps DOCX source entries separate without inventing PDF pages", async () => {
  const extraction = normalizeLlamaParseResult(
    [
      {
        pages: [
          { page: 1, md: "First rendered source." },
          { page: 2, md: "Second rendered source." },
        ],
      },
    ],
    {
      filename: "guide.docx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  );

  const parents = await buildDocumentChunks(
    extraction,
    "document-2",
    "guide.docx",
    () => {},
  );

  assert.deepEqual(
    parents.map((parent) => parent.metadata.source.id),
    ["source-1", "source-2"],
  );

  assert.deepEqual(
    parents.map(
      (parent) => parent.metadata.source.parserPageNumber,
    ),
    [1, 2],
  );

  for (const parent of parents) {
    assert.equal(parent.metadata.page_number, null);
    assert.deepEqual(parent.metadata.source_pages, []);
  }
});

test("retains document locations for Markdown", async () => {
  const extraction = normalizeTextDocument(
    "# Notes\n\nA source passage.",
    {
      filename: "notes.md",
      mimetype: "text/markdown",
    },
  );

  const parents = await buildDocumentChunks(
    extraction,
    "document-3",
    "notes.md",
    () => {},
  );

  assert.equal(
    parents[0].metadata.source.kind,
    "document",
  );

  assert.equal(parents[0].metadata.page_number, null);
});

test("rejects the old array-only chunker input", async () => {
  await assert.rejects(
    () =>
      buildDocumentChunks(
        [{ text: "Old input" }],
        "document-4",
        "old.txt",
        () => {},
      ),
    /normalized extraction/,
  );
});