import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const markdownParser = unified().use(remarkParse).use(remarkGfm);

const EXCLUDED_BLOCKS = new Set([
  "code",
  "html",
  "table",
  "footnoteDefinition",
]);

function inlineText(node) {
  if (node.type === "text" || node.type === "inlineCode") {
    return node.value;
  }

  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }

  if (node.type === "break") {
    return " ";
  }

  return (node.children ?? []).map(inlineText).join("");
}

function readNumbering(text) {
  const match = text
    .trim()
    .match(/^(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)*)([.)])?[ \t]+/);

  if (!match || (!match[2] && !match[1].includes("."))) {
    return null;
  }

  return {
    label: match[1],
    parts: match[1].split("."),
    delimiter: match[2] ?? null,
  };
}

function isUppercase(text) {
  return /\p{Lu}/u.test(text) && !/\p{Ll}/u.test(text);
}

function buildRuns(pages) {
  const runs = [];
  const seenIds = new Set();

  for (const page of pages) {
    if (
      !page ||
      typeof page.id !== "string" ||
      !page.id ||
      seenIds.has(page.id) ||
      typeof page.text !== "string" ||
      !["markdown", "plain"].includes(page.textFormat)
    ) {
      throw new TypeError("Expected normalized sources with unique IDs");
    }

    seenIds.add(page.id);

    let run = runs.at(-1);

    if (!run || run.format !== page.textFormat) {
      run = {
        format: page.textFormat,
        text: "",
        ranges: [],
      };

      runs.push(run);
    }

    if (run.ranges.length > 0) {
      run.text += "\n\n";
    }

    const start = run.text.length;

    run.text += page.text;

    run.ranges.push({
      page,
      start,
      end: run.text.length,
    });
  }

  return runs;
}

function locate(run, start, end) {
  const locations = [];

  for (const range of run.ranges) {
    const overlapStart = Math.max(start, range.start);
    const overlapEnd = Math.min(end, range.end);

    if (overlapStart >= overlapEnd) {
      continue;
    }

    locations.push({
      sourceId: range.page.id,
      sourceKind: range.page.sourceKind,
      sequenceIndex: range.page.sequenceIndex,
      sourcePageNumber: range.page.sourcePageNumber,
      parserPageNumber: range.page.parserPageNumber,
      startOffset: overlapStart - range.start,
      endOffset: overlapEnd - range.start,
    });
  }

  return locations;
}

export function collectHeadingCandidates(
  extraction,
  { maxHeuristicLength = 240 } = {},
) {
  if (
    extraction?.schemaVersion !== "extraction-v1" ||
    !Array.isArray(extraction.pages) ||
    extraction.pages.length === 0
  ) {
    throw new TypeError("Expected a normalized extraction");
  }

  if (!Number.isSafeInteger(maxHeuristicLength) || maxHeuristicLength < 1) {
    throw new TypeError("maxHeuristicLength must be a positive integer");
  }

  const runs = buildRuns(extraction.pages);
  const candidates = [];
  const excludedBlocks = [];

  for (const run of runs) {
    function addCandidate({
      start,
      end,
      title,
      kind,
      originalLevel = null,
      containers = [],
      numberingText = title,
    }) {
      const locations = locate(run, start, end);
      const warnings = [];

      if (kind !== "markdown_heading") {
        warnings.push("HEADING_ROLE_UNRESOLVED");
      }

      if (containers.includes("listItem")) {
        warnings.push("LIST_CONTEXT");
      }

      if (containers.includes("blockquote")) {
        warnings.push("BLOCKQUOTE_CONTEXT");
      }

      if (locations.length > 1) {
        warnings.push("SPANS_MULTIPLE_SOURCES");
      }

      if (run.format === "plain") {
        warnings.push("PLAIN_TEXT_STRUCTURE");
      }

      candidates.push({
        id: "heading-candidate-" + (candidates.length + 1),
        title,
        rawText: run.text.slice(start, end),
        kind,
        originalLevel,
        numbering: readNumbering(numberingText),
        locations,
        containers,
        status: "unresolved",
        warnings,
      });
    }

    function visit(node, ancestors = []) {
      if (EXCLUDED_BLOCKS.has(node.type)) {
        excludedBlocks.push({
          kind: node.type,
          locations: locate(
            run,
            node.position.start.offset,
            node.position.end.offset,
          ),
        });

        return;
      }

      if (node.type === "heading") {
        addCandidate({
          start: node.position.start.offset,
          end: node.position.end.offset,
          title: inlineText(node).trim(),
          kind: "markdown_heading",
          originalLevel: node.depth,
          containers: ancestors.map((ancestor) => ancestor.type),
        });

        return;
      }

      if (node.type === "paragraph") {
        const title = inlineText(node).trim();
        const start = node.position.start.offset;
        const end = node.position.end.offset;
        const rawText = run.text.slice(start, end);

        // Heuristics apply only to short, single-line paragraphs.
        if (
          !title ||
          title.length > maxHeuristicLength ||
          /[\r\n]/.test(rawText)
        ) {
          return;
        }

        const containers = ancestors.map((ancestor) => ancestor.type);

        const parent = ancestors.at(-1);
        const containingList = ancestors.at(-2);

        if (containers.includes("listItem")) {
          if (
            parent?.type === "listItem" &&
            containingList?.type === "list" &&
            containingList.ordered &&
            parent.children[0] === node
          ) {
            addCandidate({
              start: parent.position.start.offset,
              end,
              title,
              kind: "ordered_list_item",
              containers,
              numberingText: run.text.slice(parent.position.start.offset, end),
            });
          }

          return;
        }

        // Headerless table fragments may be parsed as paragraphs.
        if (rawText.includes("|")) {
          excludedBlocks.push({
            kind: "unresolved_pipe_text",
            locations: locate(run, start, end),
          });

          return;
        }

        let kind = null;

        if (node.children.length === 1 && node.children[0].type === "strong") {
          kind = "standalone_bold";
        } else if (readNumbering(title)) {
          kind = "numbered_text";
        } else if (isUppercase(title)) {
          kind = "uppercase_text";
        }

        if (kind) {
          addCandidate({
            start,
            end,
            title,
            kind,
            containers,
          });
        }

        return;
      }

      for (const child of node.children ?? []) {
        visit(child, [...ancestors, node]);
      }
    }

    if (run.format === "markdown") {
      visit(markdownParser.parse(run.text));
    } else {
      for (const match of run.text.matchAll(/[^\r\n]+/g)) {
        const title = match[0].trim();

        if (!title || title.length > maxHeuristicLength) {
          continue;
        }

        const kind = readNumbering(title)
          ? "numbered_text"
          : isUppercase(title)
            ? "uppercase_text"
            : null;

        if (kind) {
          addCandidate({
            start: match.index,
            end: match.index + match[0].length,
            title,
            kind,
          });
        }
      }
    }
  }

  return {
    version: "heading-candidates-v1",
    evidenceSources: ["normalized_text"],
    candidates,
    excludedBlocks,
    warnings:
      runs.length > 1 ? ["FORMAT_BOUNDARY_RESETS_MARKDOWN_CONTEXT"] : [],
  };
}

export function parseDocumentRuns(extraction) {
  if (
    extraction?.schemaVersion !== "extraction-v1" ||
    !Array.isArray(extraction.pages) ||
    extraction.pages.length === 0
  ) {
    throw new TypeError("Expected a normalized extraction");
  }

  return buildRuns(extraction.pages).map((run) => ({
    ...run,
    tree: run.format === "markdown" ? markdownParser.parse(run.text) : null,
  }));
}

export { locate as locateSourceRange };
