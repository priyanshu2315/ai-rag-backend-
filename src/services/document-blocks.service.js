import {
  parseDocumentRuns,
  locateSourceRange,
} from "./heading-candidates.service.js";

function inlineText(node) {
  if (["text", "inlineCode", "html"].includes(node.type)) {
    return node.value;
  }

  if (["image", "imageReference"].includes(node.type)) {
    return node.alt ?? "";
  }

  if (node.type === "break") {
    return "\n";
  }

  return (node.children ?? [])
    .map(inlineText)
    .join("");
}

function indexSections(extraction, sections) {
  if (!Array.isArray(sections)) {
    throw new TypeError("Expected document sections");
  }

  const pages = new Map(
    extraction.pages.map((page) => [page.id, page]),
  );

  const index = new Map();
  const ids = new Set();

  for (const section of sections) {
    if (!section.id || ids.has(section.id)) {
      throw new Error("Section IDs must be unique");
    }

    ids.add(section.id);

    for (const part of section.parts) {
      const span = part.sourceSpan;
      const page = pages.get(span?.sourceId);

      if (
        !page ||
        !Number.isSafeInteger(span.startOffset) ||
        !Number.isSafeInteger(span.endOffset) ||
        span.startOffset < 0 ||
        span.endOffset <= span.startOffset ||
        span.endOffset > page.text.length ||
        part.text !== page.text.slice(
          span.startOffset,
          span.endOffset,
        )
      ) {
        throw new Error(
          "Section part does not match its source",
        );
      }

      const entries = index.get(page.id) ?? [];

      entries.push({
        ...span,
        section,
      });

      index.set(page.id, entries);
    }
  }

  // Reject a section plan that loses or overlaps source text.
  for (const page of extraction.pages) {
    const entries = (
      index.get(page.id) ?? []
    ).sort((a, b) => a.startOffset - b.startOffset);

    let cursor = 0;

    for (const entry of entries) {
      if (entry.startOffset !== cursor) {
        throw new Error(
          "Section coverage has a gap or overlap",
        );
      }

      cursor = entry.endOffset;
    }

    if (cursor !== page.text.length) {
      throw new Error(
        "Section coverage is incomplete",
      );
    }
  }

  return index;
}

export function collectDocumentBlocks(
  extraction,
  sections,
) {
  const runs = parseDocumentRuns(extraction);
  const sectionIndex = indexSections(
    extraction,
    sections,
  );

  const blocks = [];
  let nextId = 1;

  function context(locations) {
    const matches = new Map();

    for (const location of locations) {
      const entries =
        sectionIndex.get(location.sourceId) ?? [];

      for (const entry of entries) {
        if (
          location.startOffset < entry.endOffset &&
          location.endOffset > entry.startOffset
        ) {
          matches.set(
            entry.section.id,
            entry.section,
          );
        }
      }
    }

    return {
      readingOrderSectionIds: [...matches.keys()],
      ownershipStatus: "unresolved",
      crossesSectionBoundary: matches.size > 1,
      sectionRequiresReview: [...matches.values()].some(
        (section) => section.structure.review_required,
      ),
    };
  }

  for (const run of runs) {
    function range(start, end) {
      const locations = locateSourceRange(
        run,
        start,
        end,
      );

      const sourceTextLength = locations.reduce(
        (total, location) =>
          total +
          location.endOffset -
          location.startOffset,
        0,
      );

      return {
        rawText: run.text.slice(start, end),
        locations,
        containsInsertedSeparators:
          sourceTextLength !== end - start,
      };
    }

    function span(node) {
      return range(
        node.position.start.offset,
        node.position.end.offset,
      );
    }

    function row(node) {
      return {
        ...span(node),

        cells: node.children.map((cell) => ({
          ...span(cell),
          text: inlineText(cell),
        })),
      };
    }

    function convert(node) {
      const evidence = span(node);

      const supported = new Set([
        "heading",
        "paragraph",
        "table",
        "list",
        "code",
        "blockquote",
        "thematicBreak",
        "listItem",
      ]);

      const block = {
        id: "block-" + nextId++,
        type: supported.has(node.type)
          ? node.type
          : "raw",
        sourceType: node.type,
        ...evidence,
        sectionContext: context(evidence.locations),
        warnings: [],
      };

      if (evidence.containsInsertedSeparators) {
        block.warnings.push(
          "SOURCE_SEPARATOR_INSERTED",
        );
      }

      if (block.sectionContext.crossesSectionBoundary) {
        block.warnings.push(
          "BLOCK_CROSSES_SECTION_BOUNDARY",
        );
      }

      if (block.sectionContext.sectionRequiresReview) {
        block.warnings.push(
          "SECTION_REQUIRES_REVIEW",
        );
      }

      if (node.type === "table") {
        const [header, ...rows] =
          node.children.map(row);

        block.table = {
          header,
          rows,
          align: [...node.align],
        };

        if (
          header.cells.some(
            (cell) => !cell.text.trim(),
          )
        ) {
          block.warnings.push(
            "EMPTY_COLUMN_LABEL",
          );
        }

        if (
          rows.some(
            (item) =>
              item.cells.length !==
              header.cells.length,
          )
        ) {
          block.warnings.push(
            "TABLE_ROW_WIDTH_MISMATCH",
          );
        }
      } else if (node.type === "list") {
        block.list = {
          ordered: node.ordered,
          start: node.start ?? null,
          spread: node.spread,
          items: node.children.map(convert),
        };

        if (evidence.locations.length > 1) {
          block.warnings.push(
            "CROSS_SOURCE_LIST_GROUPING_UNCONFIRMED",
          );
        }
      } else if (node.type === "listItem") {
        block.item = {
          marker:
            evidence.rawText.match(
              /^(?:\d+[.)]|[-+*])(?=\s)/,
            )?.[0] ?? null,

          checked: node.checked ?? null,
          blocks: node.children.map(convert),
        };
      } else if (node.type === "blockquote") {
        block.blocks = node.children.map(convert);
      } else if (node.type === "code") {
        block.code = {
          language: node.lang ?? null,
          meta: node.meta ?? null,
        };
      } else if (node.type === "heading") {
        block.heading = {
          level: node.depth,
          text: inlineText(node),
        };
      } else if (
        node.type === "paragraph" &&
        evidence.rawText.includes("|")
      ) {
        block.warnings.push(
          "POSSIBLE_TABLE_FRAGMENT",
        );
      } else if (block.type === "raw") {
        block.warnings.push(
          "UNSUPPORTED_BLOCK_RETAINED",
        );
      }

      return block;
    }

    function gap(start, end, warning = null) {
      if (start >= end) {
        return;
      }

      const evidence = range(start, end);

      // Separators between sources are not original content.
      if (!evidence.locations.length) {
        return;
      }

      blocks.push({
        id: "block-" + nextId++,

        type: evidence.rawText.trim()
          ? "raw"
          : "whitespace",

        sourceType: run.format,
        ...evidence,
        sectionContext: context(evidence.locations),

        warnings: [
          ...(warning ? [warning] : []),

          ...(evidence.containsInsertedSeparators
            ? ["SOURCE_SEPARATOR_INSERTED"]
            : []),
        ],
      });
    }

    if (!run.tree) {
      for (const entry of run.ranges) {
        gap(
          entry.start,
          entry.end,
          "PLAIN_TEXT_STRUCTURE_UNRESOLVED",
        );
      }

      continue;
    }

    let cursor = 0;

    for (const node of run.tree.children) {
      gap(cursor, node.position.start.offset);

      blocks.push(convert(node));

      cursor = node.position.end.offset;
    }

    gap(cursor, run.text.length);
  }

  return {
    version: "document-blocks-v1",
    evidenceSources: ["normalized_text"],
    blocks,

    warnings:
      runs.length > 1
        ? ["FORMAT_BOUNDARY_RESETS_MARKDOWN_CONTEXT"]
        : [],
  };
}