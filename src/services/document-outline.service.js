// Contents numbers currently refer to physical PDF pages (sourcePageNumber).
// The contents never fail a document: a bad or missing contents line is reported as a
// warning, and the chunker falls back to the appendix headings printed on the pages.

// "A Appendix A - Glossary", "E - Appendix E - Notes" and "Annexure B" all carry a code.
const appendixPattern = /^(?:[A-Z]\s*[-–—]?\s+)?((?:Appendix|Annexure|Annex)[\s-]+[A-Z0-9]+)\b/i;

export const normalizeWords = (text) =>
  String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function cleanLine(line) {
  return line.replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*[-*]\s+/, "").replace(/^\s*\|\s*/, "")
    .replace(/\*\*/g, "").trim();
}

function appendixCode(text) {
  return cleanLine(text).match(appendixPattern)?.[1]
    .replace(/[\s-]+/g, " ") ?? null;
}

export function outlineTitle(entry) {
  const code = (entry.sectionCode || "").trim();
  const title = (entry.title || "").trim();
  // Some contents label an appendix twice, e.g. "A Appendix A - Glossary".
  const appendix = appendixCode(title);
  const normalizedTitle = appendix ? title.replace(/^[A-Z]\s*[-–—]?\s+(?=Appendix|Annex)/i, "") : title;
  // A code the title already carries ("E" with "Appendix E - Notes") is not repeated.
  const codeInTitle = appendix && (
    appendixCode(code)?.toLowerCase() === appendix.toLowerCase() ||
    appendix.toLowerCase().endsWith(" " + code.toLowerCase())
  );
  if (!code || codeInTitle || normalizedTitle.toLowerCase().startsWith(code.toLowerCase())) {
    return normalizedTitle || code;
  }
  return `${code} - ${normalizedTitle}`;
}

const entryAppendixCode = (entry) =>
  appendixCode(entry.sectionCode) || appendixCode(outlineTitle(entry));

export function isContentsPage(page) {
  return page.isTableOfContents === true ||
    /^(?:#{1,6}\s+)?(?:Table of Contents|Contents)\s*$/im.test(page.markdown || "");
}

// Recover only unambiguous title + dot leaders + Arabic page number lines.
export function parseContentsMarkdown(pages) {
  const entries = [];
  for (const page of pages) {
    for (const rawLine of (page.markdown || "").split("\n")) {
      const match = cleanLine(rawLine).match(/^(.+?)\s*(?:\.\s*){3,}(\d+)\s*$/);
      if (!match) continue;
      const title = match[1].trim();
      const count = title.match(/\b(\d+)\s+pages?\b/i);
      entries.push({
        sectionCode: appendixCode(title) || title.match(/^(\d+(?:\.\d+)*)\s+/)?.[1] || "",
        title,
        targetPage: Number(match[2]),
        pageCount: count ? Number(count[1]) : null,
      });
    }
  }
  return entries;
}

// Merges outline entries by identity. The first mapping seen for an entry is kept;
// a later disagreement or an impossible page is recorded in `warnings`, not thrown,
// because one bad contents line must not fail the document. Only a malformed model
// response (not an array, an entry without title/sectionCode) still throws.
export function mergeOutline(previous, incoming, totalPages, { warnings = [], source = "contents" } = {}) {
  if (!Array.isArray(incoming)) throw new Error("Contents outline must be an array");
  const merged = new Map();
  const add = (entry, origin) => {
    if (!entry || typeof entry.title !== "string" || typeof entry.sectionCode !== "string") {
      throw new Error("Contents entry must have a title and sectionCode");
    }
    // Unknown printed page numbers cannot establish page ownership.
    if (entry.targetPage == null) return;
    const title = outlineTitle(entry);
    if (!Number.isSafeInteger(entry.targetPage) || entry.targetPage < 1 || entry.targetPage > totalPages) {
      warnings.push({ type: "invalid_page", source: origin, title, targetPage: entry.targetPage });
      return;
    }
    if (entry.pageCount != null &&
      (!Number.isSafeInteger(entry.pageCount) || entry.pageCount < 1 ||
        entry.targetPage + entry.pageCount - 1 > totalPages)) {
      warnings.push({ type: "invalid_range", source: origin, title, pageCount: entry.pageCount });
      return;
    }
    // "1.2 - How to read" and "1.2 How to read" are the same entry.
    const key = normalizeWords(entryAppendixCode(entry) || title);
    if (!key) throw new Error("Contents entry has no title");
    const existing = merged.get(key);
    if (existing && (existing.targetPage !== entry.targetPage ||
      (existing.pageCount != null && entry.pageCount != null && existing.pageCount !== entry.pageCount))) {
      warnings.push({
        type: "conflict", source: origin, title,
        kept: existing.targetPage, ignored: entry.targetPage,
      });
      return;
    }
    merged.set(key, {
      ...existing, ...entry,
      pageCount: entry.pageCount ?? existing?.pageCount ?? null,
    });
  };
  for (const entry of previous) add(entry, "previous");
  for (const entry of incoming) add(entry, source);
  return [...merged.values()];
}

export function missingAppendices(contentsPages, outline) {
  const expected = new Set();
  for (const page of contentsPages) {
    for (const line of (page.markdown || "").split("\n")) {
      const code = appendixCode(line);
      if (code) expected.add(code.toLowerCase());
    }
  }
  const actual = new Set(outline.map((entry) => entryAppendixCode(entry)?.toLowerCase()).filter(Boolean));
  return [...expected].filter((code) => !actual.has(code));
}

// Builds the outline for one batch. Retries once (a focused model call) when a contents
// page is present but appendix mappings are missing; what is still missing afterwards is
// reported in `warnings`, and the chunker falls back to the appendix headings on the pages.
export async function resolveContentsOutline({ result, previous = [], totalPages, retry }) {
  const warnings = [];
  const contentsPages = result.pages.filter(isContentsPage);
  const structured = mergeOutline([], result.tableOfContents ?? [], totalPages, { warnings, source: "model outline" });
  if (!contentsPages.length) {
    return { outline: mergeOutline(previous, structured, totalPages, { warnings }), warnings, retried: false };
  }
  // The structured outline is the primary source; the contents text only fills gaps.
  let batchOutline = mergeOutline(structured, parseContentsMarkdown(contentsPages), totalPages, {
    warnings, source: "contents text",
  });
  let outline = mergeOutline(previous, batchOutline, totalPages, { warnings });
  let missing = missingAppendices(contentsPages, outline);
  let retried = false;
  if (!batchOutline.length || missing.length) {
    retried = true;
    const recovered = await retry(contentsPages);
    batchOutline = mergeOutline(batchOutline, recovered.tableOfContents ?? [], totalPages, {
      warnings, source: "contents retry",
    });
    outline = mergeOutline(previous, batchOutline, totalPages, { warnings });
    missing = missingAppendices(contentsPages, outline);
  }
  if (!batchOutline.length) warnings.push({ type: "no_contents_mapping" });
  if (missing.length) warnings.push({ type: "unmapped_appendices", codes: missing });
  return { outline, warnings, retried };
}

const isSubsection = (entry) => /^\s*(?:\d+|[A-Z])\.\d+/.test(entry.sectionCode || entry.title);

// The appendix a page belongs to, or null. An appendix ends where the next top-level
// contents entry starts, including one listed after it on the same page (Annexure E and
// Annexure F both on page 30): it then covers only that page. A printed page count never
// runs into the next entry. When two appendices share a page, the earliest start wins,
// then contents order; the chunker starts the second at its own heading. Nothing here throws.
export function appendixAtPage(outline, pageNumber, totalPages) {
  const matches = [];
  outline.forEach((entry, index) => {
    const start = entry.targetPage;
    if (!entryAppendixCode(entry) || !Number.isSafeInteger(start)) return;
    // Internal subsections do not terminate their containing appendix.
    const nextStart = Math.min(totalPages + 1, ...outline
      .filter((item, other) => other !== index && !isSubsection(item) && Number.isSafeInteger(item.targetPage) &&
        (item.targetPage > start || (item.targetPage === start && other > index)))
      .map((item) => item.targetPage));
    const lastPage = Math.max(start, nextStart - 1);
    const end = entry.pageCount != null ? Math.min(start + entry.pageCount - 1, lastPage) : lastPage;
    if (pageNumber >= start && pageNumber <= end) {
      matches.push({ title: outlineTitle(entry), start, end });
    }
  });
  matches.sort((a, b) => a.start - b.start);
  return matches[0] ?? null;
}
