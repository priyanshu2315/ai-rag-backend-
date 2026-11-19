// Turns a PDF's text layer into small "units" (sentences, table rows, short lines)
// and compares two unit lists. No AI call, no database.
import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { diffArrays } from "diff";

// ---------- 1. Read the text layer ----------

export async function readPdfPages(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((page) => ({
      page: page.num,
      lines: page.text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    }));
  } finally {
    await parser.destroy();
  }
}

// ---------- 2. Remove page furniture ----------

const PAGE_NUMBER = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;

export function removeRepeatedLines(pages) {
  const EDGE = 2; // look at the first 2 and last 2 lines of each page
  const edgeCount = new Map();

  for (const { lines } of pages) {
    const edges = new Set(
      [...lines.slice(0, EDGE), ...lines.slice(-EDGE)].map(furnitureKey),
    );
    for (const key of edges) edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  }

  const minPages = Math.max(3, Math.ceil(pages.length / 2));
  const repeated = new Set(
    [...edgeCount].filter(([, n]) => n >= minPages).map(([key]) => key),
  );

  return pages.map(({ page, lines }) => ({
    page,
    lines: lines.filter(
      (line) => !PAGE_NUMBER.test(line) && !repeated.has(furnitureKey(line)),
    ),
  }));
}

// Digits masked, so "Page 1 of 9" and "Page 2 of 9" count as the same footer.
function furnitureKey(line) {
  return normalize(line).replace(/\d+/g, "#");
}

// ---------- 3. Lines -> units ----------

const SENTENCE_END = /(?<=[.?!])\s+(?=[A-Z0-9("“])/;

function wideLineLength(pages) {
  const lengths = pages
    .flatMap((p) => p.lines)
    .filter((line) => !line.includes("\t"))
    .map((line) => line.length)
    .sort((a, b) => a - b);
  if (!lengths.length) return Infinity;
  const p90 = lengths[Math.floor(lengths.length * 0.9)];
  return Math.floor(p90 * 0.75);
}

export function buildUnits(pages) {
  const wide = wideLineLength(pages);
  const units = [];
  let buffer = "";
  let bufferPage = null;

  const push = (kind, text, page) => {
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return;
    const hash = hashText(text);
    units.push({ position: units.length, kind, text, hash, page });
  };

  const flush = () => {
    if (!buffer) return;
    const parts = mergeNumberLabels(buffer.split(SENTENCE_END));
    const kind =
      parts.length > 1 || /[.?!]$/.test(buffer.trim()) ? "sentence" : "line";
    for (const part of parts) push(kind, part, bufferPage);
    buffer = "";
    bufferPage = null;
  };

  for (const { page, lines } of pages) {
    for (const line of lines) {
      if (line.includes("\t")) {
        flush();
        push("row", line.replace(/\t/g, " | "), page);
        continue;
      }

      if (!buffer) bufferPage = page;
      buffer = joinLine(buffer, line);

      const isWrapped = line.length >= wide && !/[.?!:;]$/.test(line);
      if (!isWrapped) flush();
    }
  }
  flush();
  return units;
}

// "1." + "Purpose and scope" -> "1. Purpose and scope"
function mergeNumberLabels(parts) {
  const merged = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last !== undefined && /^\d+(\.\d+)*\.$/.test(last))
      merged[merged.length - 1] = `${last} ${part}`;
    else merged.push(part);
  }
  return merged;
}

function joinLine(buffer, line) {
  if (!buffer) return line;
  if (/[A-Za-z]-$/.test(buffer)) return buffer + line; // "mini-" + "competition"
  return buffer + " " + line;
}

// ---------- 4. Hash ----------

export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashText(text) {
  return createHash("sha256")
    .update(normalize(text))
    .digest("hex")
    .slice(0, 16);
}

export function hashFile(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// ---------- 5. Public: PDF -> units ----------

export async function extractUnits(buffer) {
  const pages = removeRepeatedLines(await readPdfPages(buffer));
  return buildUnits(pages);
}

// ---------- 6. Diff two unit lists ----------

export function diffUnits(oldUnits, newUnits) {
  const parts = diffArrays(oldUnits, newUnits, {
    comparator: (a, b) => a.hash === b.hash,
  });

  const added = [];
  const removed = [];
  let kept = 0;

  for (const part of parts) {
    if (part.added) added.push(...part.value);
    else if (part.removed) removed.push(...part.value);
    else kept += part.value.length;
  }

  // Same text removed in one place and added in another = moved, not changed.
  const moved = [];
  for (const unit of [...added]) {
    const i = removed.findIndex((old) => old.hash === unit.hash);
    if (i === -1) continue;
    moved.push({ from: removed[i], to: unit });
    removed.splice(i, 1);
    added.splice(added.indexOf(unit), 1);
  }

  return { kept, added, removed, moved };
}

// ---------- 7. Link each unit to the parent chunk that holds it ----------
// Like the index at the back of a book: "this sentence -> chunk C2". Made once at upload,
// so a later re-upload can find the section of a changed sentence without any AI call.

// Letters and digits only, split at every other mark: "VEN-033" -> ["ven", "033"], so a
// code that the PDF wrapped inside a narrow table cell ("(VEN-" / "033)") still matches.
const matchWords = (text) =>
  String(text ?? "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];

// How many of the unit's words appear in the chunk in the same order.
function countWordsInOrder(unitWords, chunkWords) {
  let found = 0;
  let at = 0;
  for (const word of unitWords) {
    const index = chunkWords.indexOf(word, at);
    if (index === -1) continue;
    found++;
    at = index + 1;
  }
  return found;
}

// Short units (3 words or fewer) must match fully; longer ones need 90% of their words,
// because the chunk text is the AI's Markdown, not the PDF's exact text.
function chunkHoldsUnit(unitWords, chunkWords) {
  const found = countWordsInOrder(unitWords, chunkWords);
  return unitWords.length <= 3
    ? found === unitWords.length
    : found / unitWords.length >= 0.9;
}

export function linkUnitsToChunks(units, parents) {
  const chunks = parents.map((parent, index) => ({
    id: parent.id,
    index,
    pages: parent.metadata?.source_pages ?? [parent.metadata?.page_number],
    words: matchWords(parent.text),
  }));

  let cursor = 0; // index of the chunk the previous unit was found in
  for (const unit of units) {
    const unitWords = matchWords(unit.text);
    const onPage = chunks.filter((chunk) => chunk.pages.includes(unit.page));
    // Units and chunks are both in reading order: try the current chunk and the ones
    // after it first, so a short unit ("Internal") is not linked to an earlier chunk.
    const ordered = [
      ...onPage.filter((chunk) => chunk.index >= cursor),
      ...onPage.filter((chunk) => chunk.index < cursor),
    ];
    const match = unitWords.length
      ? ordered.find((chunk) => chunkHoldsUnit(unitWords, chunk.words))
      : null;

    unit.parentChunkId = match?.id ?? null;
    if (match) cursor = match.index;
  }
  return units;
}
