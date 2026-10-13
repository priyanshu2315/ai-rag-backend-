// Contents numbers currently refer to physical PDF pages (sourcePageNumber).
const appendixPattern = /^(?:[A-Z]\s+)?((?:Appendix|Annex)[\s-]+[A-Z0-9]+)\b/i;

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
  const normalizedTitle = appendix ? title.replace(/^[A-Z]\s+(?=Appendix|Annex)/i, "") : title;
  if (!code || normalizedTitle.toLowerCase().startsWith(code.toLowerCase())) {
    return normalizedTitle || code;
  }
  return `${code} - ${normalizedTitle}`;
}

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

export function mergeOutline(previous, incoming, totalPages) {
  if (!Array.isArray(incoming)) throw new Error("Contents outline must be an array");
  const merged = new Map();
  for (const entry of [...previous, ...incoming]) {
    if (!entry || typeof entry.title !== "string" || typeof entry.sectionCode !== "string") {
      throw new Error("Contents entry must have a title and sectionCode");
    }
    // Unknown printed page numbers cannot establish page ownership.
    if (entry.targetPage == null) continue;
    if (!Number.isSafeInteger(entry.targetPage) || entry.targetPage < 1 || entry.targetPage > totalPages) {
      throw new Error(`Invalid contents page: ${outlineTitle(entry)}`);
    }
    if (entry.pageCount != null &&
      (!Number.isSafeInteger(entry.pageCount) || entry.pageCount < 1 ||
        entry.targetPage + entry.pageCount - 1 > totalPages)) {
      throw new Error(`Invalid contents range: ${outlineTitle(entry)}`);
    }
    const key = (appendixCode(entry.sectionCode) || appendixCode(outlineTitle(entry)) || outlineTitle(entry)).toLowerCase();
    if (!key) throw new Error("Contents entry has no title");
    const existing = merged.get(key);
    if (existing && (existing.targetPage !== entry.targetPage ||
      (existing.pageCount != null && entry.pageCount != null && existing.pageCount !== entry.pageCount))) {
      throw new Error(`Conflicting contents mapping: ${key}`);
    }
    merged.set(key, {
      ...existing, ...entry,
      pageCount: entry.pageCount ?? existing?.pageCount ?? null,
    });
  }
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
  const actual = new Set(outline.map((entry) =>
    (appendixCode(entry.sectionCode) || appendixCode(outlineTitle(entry)))?.toLowerCase(),
  ).filter(Boolean));
  return [...expected].filter((code) => !actual.has(code));
}

// Retry once when the contents is present but usable appendix mappings are absent.
export async function resolveContentsOutline({ result, previous = [], totalPages, retry }) {
  const contentsPages = result.pages.filter(isContentsPage);
  let batchOutline = mergeOutline([], result.tableOfContents ?? [], totalPages);
  if (!contentsPages.length) return mergeOutline(previous, batchOutline, totalPages);
  batchOutline = mergeOutline(batchOutline, parseContentsMarkdown(contentsPages), totalPages);
  let outline = mergeOutline(previous, batchOutline, totalPages);
  if (!batchOutline.length || missingAppendices(contentsPages, outline).length) {
    const recovered = await retry(contentsPages);
    batchOutline = mergeOutline(batchOutline, recovered.tableOfContents ?? [], totalPages);
    outline = mergeOutline(previous, batchOutline, totalPages);
  }
  const missing = missingAppendices(contentsPages, outline);
  if (!batchOutline.length || missing.length) {
    throw new Error("Contents mapping remains incomplete" + (missing.length ? ": " + missing.join(", ") : ""));
  }
  return outline;
}

export function appendixAtPage(outline, pageNumber, totalPages) {
  const matches = [];
  for (const entry of outline) {
    if (!(appendixCode(entry.sectionCode) || appendixCode(outlineTitle(entry)))) continue;
    const start = entry.targetPage;
    // Internal subsections do not terminate their containing appendix.
    const nextStart = Math.min(totalPages + 1, ...outline.filter((item) =>
      !/^\s*(?:\d+|[A-Z])\.\d+/.test(item.sectionCode || item.title),
    ).map((item) => item.targetPage).filter((number) => number > start));
    const end = entry.pageCount != null ? start + entry.pageCount - 1 : nextStart - 1;
    if (end >= nextStart) throw new Error(`Overlapping appendix: ${outlineTitle(entry)}`);
    if (pageNumber >= start && pageNumber <= end) {
      matches.push({ title: outlineTitle(entry), start, end });
    }
  }
  if (matches.length > 1) throw new Error(`Ambiguous appendix on page ${pageNumber}`);
  return matches[0] ?? null;
}
