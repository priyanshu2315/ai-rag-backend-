import assert from "node:assert/strict";
import { test } from "node:test";
import {
  outlineTitle, isContentsPage, parseContentsMarkdown, mergeOutline,
  missingAppendices, resolveContentsOutline, appendixAtPage,
} from "../src/services/document-outline.service.js";
import { buildDocumentChunks } from "../src/services/simple-chunking.service.js";

const contents = {
  sourceId: "source-3", isTableOfContents: true,
  markdown: "## Table of Contents\n\n" +
    "A Appendix A - Glossary . . . . . 19\n" +
    "Appendix B - Board minutes, 22 October 2025 (scanned, 2 pages) . . . . . 20\n" +
    "Appendix C - CFO restatement letter . . . . . 22\n" +
    "Appendix D - Factory acceptance test record . . . . . 23\n" +
    "E Appendix E - Technical Notes . . . . . 24",
};
const outline = parseContentsMarkdown([contents]);
const bTitle = "Appendix B - Board minutes, 22 October 2025 (scanned, 2 pages)";
const neverRetry = () => { throw new Error("Unexpected retry"); };

test("contents detection uses the page flag or heading, ignoring a batch-level false", () => {
  assert.equal(isContentsPage(contents), true);
  assert.equal(isContentsPage({ markdown: "## Table of Contents" }), true);
  assert.equal(isContentsPage({ markdown: "See the table of contents." }), false);
});

test("dot leaders recover generic appendix identity, pages and explicit lengths", () => {
  assert.deepEqual(outline.map((entry) => entry.targetPage), [19, 20, 22, 23, 24]);
  assert.equal(outline[1].pageCount, 2);
  assert.equal(outlineTitle(outline[0]), "Appendix A - Glossary");
  assert.equal(outlineTitle({ sectionCode: "Appendix B", title: "Board minutes" }), "Appendix B - Board minutes");
  assert.deepEqual(parseContentsMarkdown([{ markdown: "Appendix X - Notes .... 7" }]), [{
    sectionCode: "Appendix X", title: "Appendix X - Notes", targetPage: 7, pageCount: null,
  }]);
});

test("empty and partially populated model outlines recover without a paid retry", async () => {
  for (const entries of [[], [outline[0]]]) {
    const result = await resolveContentsOutline({
      result: { pages: [contents], tableOfContents: entries, isTableOfContents: false },
      totalPages: 24, retry: neverRetry,
    });
    assert.equal(result.length, 5);
    assert.deepEqual(missingAppendices([contents], result), []);
  }
});

test("later contents batches add mappings and batches without contents keep the outline", async () => {
  const first = [outline[0], outline[1]];
  const combined = await resolveContentsOutline({
    previous: first, totalPages: 24, retry: neverRetry,
    result: { pages: [], tableOfContents: outline.slice(2) },
  });
  const retained = await resolveContentsOutline({
    previous: combined, totalPages: 24, retry: neverRetry,
    result: { pages: [{ markdown: "Body text" }], tableOfContents: [] },
  });
  assert.deepEqual(retained, outline);
});

test("a focused retry fills a missing mapping from a contents format without dot leaders", async () => {
  let calls = 0;
  const page = { isTableOfContents: true, markdown: "Appendix B - Minutes 20" };
  const resolved = await resolveContentsOutline({
    result: { pages: [page], tableOfContents: [] }, totalPages: 24,
    retry: async (pages) => {
      calls++;
      assert.deepEqual(pages, [page]);
      return { tableOfContents: [outline[1]] };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(resolved, [outline[1]]);
});

test("an unresolved appendix fails after one retry instead of silently losing identity", async () => {
  let calls = 0;
  await assert.rejects(resolveContentsOutline({
    result: { pages: [{ isTableOfContents: true, markdown: "Appendix B - Minutes 20" }], tableOfContents: [] },
    totalPages: 24,
    retry: async () => { calls++; return { tableOfContents: [] }; },
  }), /Contents mapping remains incomplete: appendix b/);
  assert.equal(calls, 1);
});

test("an earlier outline cannot hide missing entries on a later contents page", async () => {
  let calls = 0;
  await assert.rejects(resolveContentsOutline({
    previous: [outline[0]], totalPages: 24,
    result: { pages: [{ isTableOfContents: true, markdown: "| Section | Page |\n| --- | --- |\n| Technical Notes | 24 |" }], tableOfContents: [] },
    retry: async () => { calls++; return { tableOfContents: [] }; },
  }), /Contents mapping remains incomplete/);
  assert.equal(calls, 1);
});

test("appendix entries in a contents table also require usable mappings", () => {
  assert.deepEqual(missingAppendices([{
    markdown: "| Appendix B | Board minutes | 20 |",
  }], []), ["appendix b"]);
});

test("conflicting, out-of-range and malformed mappings are rejected", () => {
  assert.throws(() => mergeOutline([outline[1]], [{ ...outline[1], targetPage: 21 }], 24), /Conflicting/);
  assert.throws(() => mergeOutline([], [{ ...outline[1], targetPage: 25 }], 24), /Invalid contents page/);
  assert.throws(() => mergeOutline([], [{ ...outline[1], pageCount: 6 }], 24), /Invalid contents range/);
  assert.throws(() => mergeOutline([], "invalid", 24), /must be an array/);
  assert.throws(() => mergeOutline([], [null], 24), /title and sectionCode/);
  assert.deepEqual(mergeOutline([], [{ ...outline[1], targetPage: null }], 24), []);
});

test("appendix ranges retain page 21, switch on 22, and ignore internal subsections", () => {
  assert.deepEqual(appendixAtPage(outline, 21, 24), { title: bTitle, start: 20, end: 21 });
  assert.equal(appendixAtPage(outline, 22, 24).title, "Appendix C - CFO restatement letter");
  assert.equal(appendixAtPage(outline, 18, 24), null);
  const withSubsection = [...outline, { sectionCode: "B.1", title: "Agenda", targetPage: 21, pageCount: null }];
  assert.equal(appendixAtPage(withSubsection, 21, 24).title, bTitle);
  assert.throws(() => appendixAtPage([{ ...outline[1], pageCount: 3 }, outline[2]], 20, 24), /Overlapping appendix/);
  assert.throws(() => appendixAtPage([outline[1], { ...outline[1], sectionCode: "Appendix X", title: "Other minutes" }], 20, 24), /Ambiguous appendix/);
});

function sourcePage(number, text, boundaryTitle) {
  return {
    id: "source-" + number, sequenceIndex: number - 1, sourceKind: "page",
    sourcePageNumber: number, parserPageNumber: null, textFormat: "markdown",
    warnings: [], text, isDocumentBoundary: true, boundaryTitle,
  };
}

test("resolved identity reaches all parents and children while preserving source passages", async () => {
  const pages = [
    sourcePage(20, "## MINUTES OF A MEETING\n\n### 3. PERSONNEL\n\nNeha takes office on 1 November.", "Minutes of a Meeting"),
    sourcePage(21, "## Appendix B (continued)\n\n### 4. DELEGATION OF AUTHORITY\n\nCEO limit: USD 12,000,000.", "Board Minutes Excerpt"),
    sourcePage(22, "## VANTARA ENERGY SYSTEMS\n\nRestated revenue: 532.8.", "CFO letter"),
  ];
  const parents = await buildDocumentChunks({
    schemaVersion: "extraction-v1", provider: "test", warnings: [],
    documentTitle: "Integrated Report", pageCount: 24, documentOutline: outline, pages,
  }, "document-1", "report.pdf", () => {}, {
    measure: async (text) => ({ tokenCount: Math.ceil(text.length / 4), tokenLimit: 256 }),
  });
  for (const parent of parents) {
    const expected = parent.metadata.page_number === 22
      ? "Appendix C - CFO restatement letter" : bTitle;
    for (const chunk of [parent, ...parent.children]) {
      assert.equal(chunk.metadata.heading_path[0], expected);
      assert.ok(chunk.searchText.includes("Section: " + expected));
      assert.ok(chunk.metadata.token_budget.tokenCount <= chunk.metadata.token_budget.tokenLimit);
    }
  }
  assert.ok(parents.some((parent) => parent.metadata.page_number === 21));
  assert.ok(parents.filter((parent) => parent.metadata.page_number === 21).every((parent) => !parent.text.includes(bTitle)));
  const bParents = parents.filter((parent) => parent.metadata.page_number !== 22);
  assert.equal(bParents.at(-1).nextParentId, null);
  assert.equal(parents.find((parent) => parent.metadata.page_number === 22).prevParentId, null);
});

test("matching table columns cannot move Appendix C rows back into Appendix B", async () => {
  const parents = await buildDocumentChunks({
    documentTitle: "Report", pageCount: 24, documentOutline: outline,
    pages: [
      sourcePage(21, "| Item | Value |\n| --- | --- |\n| Before | 10 |", "Minutes"),
      sourcePage(22, "| Item | Value |\n| --- | --- |\n| After | 12 |", "Letter"),
    ],
  }, "doc", "report.pdf", () => {}, {
    measure: async (text) => ({ tokenCount: Math.ceil(text.length / 4), tokenLimit: 256 }),
  });
  const letter = parents.find((parent) => parent.metadata.page_number === 22);
  assert.equal(letter.metadata.heading_path[0], "Appendix C - CFO restatement letter");
  assert.deepEqual(letter.metadata.linked_table_ids, []);
});
