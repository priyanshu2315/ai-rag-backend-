# Archived ingestion and semantic chunking code

These are exact snapshots from before the Gemini-only cleanup. Paths are shown so a file can be restored later. This is reference code and is not used at runtime.

## src/services/chunking.service.js

~~~~js
﻿import { randomUUID } from "node:crypto";
import { buildDocumentSections } from "./document-sections.service.js";
import { collectDocumentBlocks } from "./document-blocks.service.js";
import { resolveDocumentRelations } from "./document-relations.service.js";
import { buildStructuralUnits } from "./structured-units.service.js";
import { packStructuralUnits } from "./token-packer.service.js";

const VERSION = "structured-context-v4";
const unique = (items) => [...new Set(items)];

export async function buildDocumentChunks(
  extraction, documentId, documentTitle, onEvent, options = {},
) {
  if (extraction?.schemaVersion !== "extraction-v1" ||
      !Array.isArray(extraction.pages) || !extraction.pages.length) {
    throw new TypeError("buildDocumentChunks requires a normalized extraction");
  }
  const report = async (event) => {
    if (onEvent) await onEvent(event);
    else if (process.env.RAG_DEBUG !== "false") {
      console.log("[Chunking]", JSON.stringify({ documentId, ...event }));
    }
  };
  const count = extraction.rawResult?.job_metadata?.job_pages;
  const sourceStats = {
    totalSources: extraction.pages.length,
    totalPages: extraction.source.mimetype === "application/pdf" &&
      Number.isSafeInteger(count) && count >= 0 ? count : null,
  };
  await report({ type: "chunking_start", stage: "preparing",
    documentTitle: extraction.source.filename, chunkerVersion: VERSION,
    sizeUnit: "tokens", ...sourceStats });

  const { identity, sections } = await buildDocumentSections(extraction, report);
  const blocks = collectDocumentBlocks(extraction, sections);
  const relations = resolveDocumentRelations(blocks, sections);
  const units = buildStructuralUnits(extraction, sections, blocks, relations);
  await report({
    type: "structure_resolved", stage: "preparing",
    totalBlocks: blocks.blocks.length, totalUnits: units.length,
    tableContinuations: relations.diagnostics, references: relations.references,
    warnings: blocks.warnings,
  });
  let packed;
  try {
    packed = await packStructuralUnits(units, sections, identity, documentId, options);
  } catch (error) {
    await report({
      type: "chunking_failed", stage: "preparing",
      code: error.code ?? "CHUNK_PACKING_FAILED",
      message: error.message, details: error.details ?? null,
    });
    throw error;
  }
  const pages = new Map(extraction.pages.map((page) => [page.id, page]));
  const sectionMap = new Map(sections.map((section) => [section.id, section]));

  function metadata(pieces, group, chunkIndex) {
    const evidence = [...new Map(pieces.map((piece) => [piece.unit.id, piece.unit])).values()];
    const locations = evidence.flatMap((unit) => unit.locations.map(
      (location) => ({ ...location, role: "passage", scope: "source_unit" })));
    const contextLocations = evidence.flatMap((unit) => unit.contextLocations);
    const page = pages.get(locations[0].sourceId);
    const section = sectionMap.get(group.sectionId);
    const blockIds = unique(evidence.map((unit) => unit.blockId).filter(Boolean));
    return {
      page_number: page.sourcePageNumber,
      source_pages: unique([...locations, ...contextLocations]
        .map((location) => location.sourcePageNumber).filter((value) => value != null)),
      source: {
        id: page.id, kind: page.sourceKind, sequenceIndex: page.sequenceIndex,
        parserPageNumber: page.parserPageNumber, sourcePageNumber: page.sourcePageNumber,
        textFormat: page.textFormat, warnings: page.warnings,
      },
      source_locations: locations, context_locations: contextLocations,
      extraction: { schema_version: extraction.schemaVersion, provider: extraction.provider,
        job_id: extraction.jobId, warnings: extraction.warnings },
      document_title: identity.title, document_identity: identity,
      heading_path: section?.headingPath ?? [],
      section_id: group.sectionId ?? "unresolved-" + (blockIds[0] ?? evidence[0].id),
      section_structure: section?.structure ?? {
        status: "unresolved", review_required: true, boundary: null,
      },
      section_part_index: null, section_part_span: null,
      reading_section_ids: unique(evidence.map((unit) => unit.readingSectionId).filter(Boolean)),
      chunk_index: chunkIndex, chunker_version: VERSION,
      block_ids: blockIds, source_unit_ids: evidence.map((unit) => unit.id),
      block_types: unique(evidence.map((unit) => unit.kind)),
      table_ids: unique(evidence.map((unit) => unit.tableId).filter(Boolean)),
      row_ids: unique(evidence.map((unit) => unit.rowId).filter(Boolean)),
      list_item_ids: unique(evidence.map((unit) => unit.listItemId).filter(Boolean)),
      contains_unit_fragments: pieces.some((piece) => piece.fragment),
      context_compacted: group.compacted,
      structure_warnings: unique(evidence.flatMap((unit) => unit.warnings)),
      relationships: relations.diagnostics.filter((item) => blockIds.includes(item.blockId)),
      references: relations.references.filter((ref) =>
        ref.sourceSectionId === group.sectionId || ref.targetSectionId === group.sectionId),
    };
  }

  const parents = packed.map((group, index) => {
    const parentId = randomUUID();
    return {
      id: parentId, documentId, text: group.text, searchText: group.searchText,
      metadata: {
        ...metadata(group.pieces, group, index),
        token_budget: { tokenCount: group.tokenCount, tokenLimit: group.tokenLimit },
      },
      prevParentId: null, nextParentId: null,
      children: group.children.map((child, childIndex) => ({
        id: randomUUID(), documentId, parentId,
        text: child.text, searchText: child.searchText,
        metadata: {
          ...metadata(child.pieces, group, index), child_index: childIndex,
          token_budget: { ...child.tokens, tokenLimit: group.childLimit,
            withinLimit: child.tokens.tokenCount <= group.childLimit },
        },
      })),
    };
  });
  if (!parents.length) throw new Error("Document contains no extractable text");

  const previous = new Map();
  for (const parent of parents) {
    const sectionId = parent.metadata.section_id;
    const before = previous.get(sectionId);
    if (before) { before.nextParentId = parent.id; parent.prevParentId = before.id; }
    previous.set(sectionId, parent);
  }
  const idsBySection = new Map();
  for (const parent of parents) {
    const id = parent.metadata.section_id;
    idsBySection.set(id, [...(idsBySection.get(id) ?? []), parent.id]);
  }
  for (const parent of parents) {
    const linked = parent.metadata.references.map((reference) => ({
      ...reference, targetParentIds: reference.targetSectionId
        ? idsBySection.get(reference.targetSectionId) ?? [] : [],
    }));
    parent.metadata.references = linked;
    for (const child of parent.children) child.metadata.references = linked;
    await report({ type: "parent_created", stage: "preparing",
      parent: { ...parent, children: undefined, totalChildren: parent.children.length } });
    for (const child of parent.children) {
      await report({ type: "child_created", stage: "preparing", child });
    }
    await report({ type: "parent_links", stage: "preparing",
      sectionId: parent.metadata.section_id, parentId: parent.id,
      prevParentId: parent.prevParentId, nextParentId: parent.nextParentId });
  }
  await report({
    type: "chunking_complete", stage: "preparing", ...sourceStats,
    totalSections: unique(parents.map((parent) => parent.metadata.section_id)).length,
    totalParents: parents.length,
    totalChildren: parents.reduce((sum, parent) => sum + parent.children.length, 0),
    sections: unique(parents.map((parent) => parent.metadata.section_id)).map((id) => {
      const items = parents.filter((parent) => parent.metadata.section_id === id);
      return {
        id, headingPath: items[0].metadata.heading_path,
        structure: items[0].metadata.section_structure,
        sourcePages: unique(items.flatMap((parent) => parent.metadata.source_pages)),
        sourceIds: unique(items.map((parent) => parent.metadata.source.id)),
        totalParents: items.length,
        totalChildren: items.reduce((sum, parent) => sum + parent.children.length, 0),
      };
    }),
  });
  return parents;
}
~~~~

## src/services/document-blocks.service.js

~~~~js
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
~~~~

## src/services/document-identity.service.js

~~~~js
const TITLE_KINDS = new Set([
  "markdown_heading",
  "standalone_bold",
  "uppercase_text",
]);

export function buildDocumentIdentity(extraction, headingResult) {
  if (
    extraction?.schemaVersion !== "extraction-v1" ||
    !Array.isArray(extraction.pages) ||
    extraction.pages.length === 0 ||
    typeof extraction.source?.filename !== "string" ||
    !extraction.source.filename.trim()
  ) {
    throw new TypeError(
      "Expected a normalized extraction with a filename",
    );
  }

  if (
    headingResult?.version !== "heading-candidates-v1" ||
    !Array.isArray(headingResult.candidates)
  ) {
    throw new TypeError(
      "Expected collected heading candidates",
    );
  }

  const openingSource = extraction.pages.find(
    (page) => page.text.trim(),
  );

  const parts = [];
  let cursor = 0;

  if (openingSource) {
    const candidates = headingResult.candidates
      .filter((candidate) =>
        candidate.locations.some(
          (location) =>
            location.sourceId === openingSource.id,
        ),
      )
      .sort(
        (a, b) =>
          a.locations[0].startOffset -
          b.locations[0].startOffset,
      );

    for (const candidate of candidates) {
      // A title split between sources needs a later
      // structural decision.
      if (candidate.locations.length !== 1) {
        break;
      }

      const location = candidate.locations[0];
      const { startOffset, endOffset } = location;

      if (
        !Number.isSafeInteger(startOffset) ||
        !Number.isSafeInteger(endOffset) ||
        startOffset < 0 ||
        endOffset <= startOffset ||
        endOffset > openingSource.text.length ||
        openingSource.text.slice(
          startOffset,
          endOffset,
        ) !== candidate.rawText
      ) {
        throw new TypeError(
          "Heading evidence does not match its source",
        );
      }

      // Only examine the uninterrupted heading run
      // at the document opening.
      if (
        startOffset < cursor ||
        openingSource.text.slice(
          cursor,
          startOffset,
        ).trim()
      ) {
        break;
      }

      if (
        !TITLE_KINDS.has(candidate.kind) ||
        candidate.numbering !== null ||
        !candidate.title.trim() ||
        candidate.containers.some(
          (type) => type !== "root",
        )
      ) {
        break;
      }

      parts.push({
        candidateId: candidate.id,
        text: candidate.title,
        kind: candidate.kind,
        originalLevel: candidate.originalLevel,
        locations: structuredClone(
          candidate.locations,
        ),
      });

      cursor = endOffset;
    }
  }

  const normalized = (value) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const stem = extraction.source.filename.replace(/\.[^.]+$/, "");
  const filenameMatch = parts[0] && normalized(parts[0].text) === normalized(stem);
  const nextSource = openingSource && extraction.pages.find(
    (page) => page.sequenceIndex > openingSource.sequenceIndex && page.text.trim(),
  );
  const nextHeading = nextSource && headingResult.candidates.find(
    (candidate) => candidate.locations[0]?.sourceId === nextSource.id,
  );
  const coverEvidence = parts.length > 0 && openingSource &&
    !openingSource.text.slice(cursor).trim() &&
    nextHeading?.kind === "markdown_heading" && nextHeading.numbering &&
    !nextSource.text.slice(0, nextHeading.locations[0].startOffset).trim();
  const accepted = coverEvidence ? parts : filenameMatch ? [parts[0]] : [];
  const detected = accepted.length > 0;

  return {
    version: "document-identity-v1",

    filename: extraction.source.filename,
    title: detected ? accepted.map((part) => part.text).join(" \u2014 ") : extraction.source.filename,
    titleSource: detected ? (coverEvidence ? "opening_cover" : "filename_match") : "filename",
    status: detected ? "inferred" : "fallback",
    acceptedCandidateIds: accepted.map((part) => part.candidateId),

    proposal: parts.length
      ? {
          status: "unresolved",
          text: parts
            .map((part) => part.text)
            .join("\n"),
          parts,
        }
      : null,

    warnings: [
      detected ? "DOCUMENT_TITLE_INFERRED" : parts.length
        ? "DOCUMENT_TITLE_UNCONFIRMED"
        : "DOCUMENT_TITLE_NOT_IDENTIFIED",
    ],
  };
}
~~~~

## src/services/document-sections.service.js

~~~~js
import {
  collectHeadingCandidates,
} from "./heading-candidates.service.js";

import {
  buildDocumentIdentity,
} from "./document-identity.service.js";

import {
  normalizeHeadingStructure,
} from "./heading-structure.service.js";

function sourceDetails(page) {
  return {
    id: page.id,
    kind: page.sourceKind,
    sequenceIndex: page.sequenceIndex,
    parserPageNumber: page.parserPageNumber,
    sourcePageNumber: page.sourcePageNumber,
    textFormat: page.textFormat,
    warnings: page.warnings,
  };
}

export async function buildDocumentSections(
  extraction,
  report = () => {},
) {
  const candidates = collectHeadingCandidates(extraction);

  const identity = buildDocumentIdentity(
    extraction,
    candidates,
  );

  const structure = normalizeHeadingStructure(
    candidates,
    identity,
  );

  const pagesById = new Map(
    extraction.pages.map((page) => [page.id, page]),
  );

  const boundaries = new Map();
  const paths = new Map();

  await report({
    type: "document_identity",
    stage: "preparing",
    identity,
  });

  for (const decision of structure.decisions) {
    for (const location of decision.locations) {
      const page = pagesById.get(location.sourceId);

      if (
        !page ||
        !Number.isSafeInteger(location.startOffset) ||
        !Number.isSafeInteger(location.endOffset) ||
        location.startOffset < 0 ||
        location.endOffset <= location.startOffset ||
        location.endOffset > page.text.length
      ) {
        throw new Error("Invalid heading source location");
      }
    }

    const first = decision.locations[0];

    if (!first) {
      throw new Error(
        "Heading decision has no source location",
      );
    }

    const page = pagesById.get(first.sourceId);

    if (
      decision.locations.length === 1 &&
      page.text.slice(
        first.startOffset,
        first.endOffset,
      ) !== decision.rawText
    ) {
      throw new Error(
        "Heading text does not match its source",
      );
    }

    await report({
      type: "heading_decision",
      stage: "preparing",
      page: page.sourcePageNumber,
      source: sourceDetails(page),
      decision,
    });

    if (
      decision.status === "inferred" &&
      decision.role === "section"
    ) {
      const parentPath = decision.parentCandidateId
        ? paths.get(decision.parentCandidateId)
        : [];

      if (!parentPath) {
        throw new Error(
          "Heading parent must precede its child",
        );
      }

      paths.set(decision.id, [
        ...parentPath,
        {
          id: decision.id,
          title: decision.title,
        },
      ]);
    }

    // Lists and quoted headings remain inside
    // the surrounding passage.
    if (decision.role === "content") {
      continue;
    }

    const entries = boundaries.get(first.sourceId) ?? [];

    entries.push({
      offset: first.startOffset,
      decision,
    });

    boundaries.set(first.sourceId, entries);
  }

  const sections = [];
  let current = null;

  async function startSection(decision, page) {
    const path = decision
      ? paths.get(decision.id) ?? []
      : [];

    current = {
      id: "section-" + (sections.length + 1),

      headingPath: path.map((entry) => entry.title),

      structure: {
        version: structure.version,
        status: decision?.status ?? "unassigned",
        heading_candidate_ids: path.map(
          (entry) => entry.id,
        ),
        boundary: decision,
        review_required:
          decision?.status === "unresolved",
      },

      parts: [],
    };

    sections.push(current);

    await report({
      type: "section",
      stage: "preparing",
      sectionId: current.id,
      headingPath: current.headingPath,
      structure: current.structure,
      page: page.sourcePageNumber,
      source: sourceDetails(page),
    });
  }

  async function appendPart(
    page,
    startOffset,
    endOffset,
  ) {
    if (startOffset === endOffset) {
      return;
    }

    if (!current) {
      await startSection(null, page);
    }

    const part = {
      text: page.text.slice(startOffset, endOffset),
      pageNumber: page.sourcePageNumber,
      source: sourceDetails(page),

      sourceSpan: {
        sourceId: page.id,
        startOffset,
        endOffset,
      },
    };

    current.parts.push(part);

    await report({
      type: "section_part",
      stage: "preparing",
      sectionId: current.id,
      headingPath: current.headingPath,
      structure: current.structure,
      page: part.pageNumber,
      source: part.source,
      sourceSpan: part.sourceSpan,
      partIndex: current.parts.length - 1,
      text: part.text,
      textLength: part.text.length,
    });
  }

  for (const page of extraction.pages) {
    const entries = (
      boundaries.get(page.id) ?? []
    ).sort((a, b) => a.offset - b.offset);

    let cursor = 0;
    let previousBoundary = -1;

    for (const { offset, decision } of entries) {
      if (offset <= previousBoundary) {
        throw new Error(
          "Overlapping section boundaries",
        );
      }

      await appendPart(page, cursor, offset);
      await startSection(decision, page);

      cursor = offset;
      previousBoundary = offset;
    }

    await appendPart(
      page,
      cursor,
      page.text.length,
    );
  }

  return {
    identity,
    structure,
    sections,
  };
}
~~~~

## src/services/document-relations.service.js

~~~~js
// Resolve only relationships supported by extracted source evidence.
const key = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const sectionNumber = (section) =>
  section.structure.boundary?.numbering?.label.toUpperCase() ?? null;

export function walkBlocks(blocks) {
  return blocks.flatMap((block) => [
    block,
    ...walkBlocks(
      block.list?.items ?? block.item?.blocks ?? block.blocks ?? [],
    ),
  ]);
}

function pipeCells(line) {
  const text = line.trim();
  if (!text.startsWith("|") || !text.endsWith("|")) return null;
  const cells = [];
  let value = "";
  for (let i = 1; i < text.length - 1; i++) {
    if (
      text[i] === "\\" &&
      i + 1 < text.length - 1 &&
      ["\\", "|"].includes(text[i + 1])
    ) {
      value += text[++i];
    } else if (text[i] === "|") {
      cells.push(value.trim());
      value = "";
    } else value += text[i];
  }
  cells.push(value.trim());
  return cells;
}

function fragmentRows(block) {
  if (!block.warnings.includes("POSSIBLE_TABLE_FRAGMENT")) return null;
  const lines = block.rawText.trim().split(/\r?\n/);
  const cells = lines.map(pipeCells);
  if (
    !cells.length ||
    cells.some((row) => !row || row.some((cell) => /^:?-{3,}:?$/.test(cell)))
  )
    return null;
  return cells.map((row) => ({
    rawText: row.join(" | "),
    locations: block.locations,
    cells: row.map((text) => ({
      text,
      rawText: text,
      locations: block.locations,
    })),
    evidenceScope: "block",
  }));
}

function consecutive(previous, next) {
  const a = /([A-Za-z_-]+)(\d+)/.exec(previous?.cells[0]?.text || "");
  const b = /([A-Za-z_-]+)(\d+)/.exec(next?.cells[0]?.text || "");
  return Boolean(
    a &&
    b &&
    a[1] === b[1] &&
    a[2].length === b[2].length &&
    BigInt(b[2]) === BigInt(a[2]) + 1n,
  );
}

export function resolveDocumentRelations(blockPlan, sections) {
  const blocks = walkBlocks(blockPlan.blocks);
  const bySection = new Map(sections.map((section) => [section.id, section]));
  const labels = new Map();
  for (const section of sections) {
    const label = sectionNumber(section);
    if (label) labels.set(label, [...(labels.get(label) ?? []), section]);
  }

  const tables = [];
  const members = new Map();
  const diagnostics = [];
  for (const block of blocks) {
    let matchType = null;
    let matchedRows = null;
    const source = block.locations[0];

    const possible = tables.filter((table) => {
      if (!table.lastRow) return false;
      const previous = table.lastLocation;
      if (source.sequenceIndex !== previous.sequenceIndex + 1) return false;

      const numeric = (value) =>
        /^[-+]?[$€£₹]?\(?\d[\d,.\s]*\)?%?$/.test(value.trim());

      const checkMatch = (testRows, requireHeaderMatch) => {
        if (!testRows || !testRows.length) return false;
        if (
          testRows.some((row) => row.cells.length !== table.header.cells.length)
        )
          return false;
        if (!consecutive(table.lastRow, testRows[0])) return false;
        if (
          testRows[0].cells.slice(1).some((cell, i) => {
            const prior = table.lastRow.cells[i + 1]?.text ?? "";
            return (
              prior.trim() &&
              cell.text.trim() &&
              numeric(prior) !== numeric(cell.text)
            );
          })
        )
          return false;
        if (!testRows.slice(1).every((row, i) => consecutive(testRows[i], row)))
          return false;
        if (
          requireHeaderMatch &&
          block.table &&
          block.table.header.cells.some(
            (cell, i) => key(cell.text) !== key(table.header.cells[i].text),
          )
        )
          return false;
        return true;
      };

      if (block.table) {
        const headlessRows = [block.table.header, ...block.table.rows];
        if (checkMatch(headlessRows, false)) {
          matchType = "headless";
          matchedRows = headlessRows;
          return true;
        }
        if (checkMatch(block.table.rows, true)) {
          matchType = "standard";
          matchedRows = block.table.rows;
          return true;
        }
        return false;
      } else {
        const fRows = fragmentRows(block);
        if (checkMatch(fRows, false)) {
          matchType = "fragment";
          matchedRows = fRows;
          return true;
        }
        return false;
      }
    });

    let table;
    const rowsToUse =
      matchedRows ?? block.table?.rows ?? fragmentRows(block) ?? [];
    if (!rowsToUse.length) continue;

    if (possible.length === 1) {
      table = possible[0];
      diagnostics.push({
        type: "table_continuation",
        status: "inferred",
        blockId: block.id,
        tableId: table.id,
        evidence: [
          "ADJACENT_SOURCE",
          "COMPATIBLE_COLUMN_COUNT",
          "CONSECUTIVE_ROW_IDS",
          ...(matchType === "standard" ? ["MATCHING_HEADERS"] : []),
          ...(matchType === "headless" ? ["HEADLESS_CONTINUATION"] : []),
        ],
      });
    } else if (block.table) {
      let actualHeader = block.table.header;

      // If the parsed header is actually the first data row

      const firstDataRow = block.table.rows.find(row => row.cells.some(c => c.text.trim()));
      if (
        firstDataRow &&
        consecutive(block.table.header, firstDataRow)
      ) {
        rowsToUse.unshift(block.table.header);
        actualHeader = {
          cells: block.table.header.cells.map((_, i) => ({
            text: `Column ${i + 1}`,
          })),
          locations: block.locations || [],
        };
      }

      table = {
        id: "table-" + (tables.length + 1),
        header: actualHeader,
        sectionId:
          block.sectionContext.readingOrderSectionIds.length === 1
            ? block.sectionContext.readingOrderSectionIds[0]
            : null,
        memberIds: [],
        definitions: {},
        references: [],
        notes: [],
        warnings: [...block.warnings],
      };
      tables.push(table);
    } else {
      diagnostics.push({
        type: "table_continuation",
        status: "unresolved",
        blockId: block.id,
        candidateTableIds: possible.map((item) => item.id),
        reason: possible.length
          ? "AMBIGUOUS_TABLE_MATCH"
          : "NO_SUPPORTED_TABLE_MATCH",
      });
      continue;
    }
    if (possible.length > 1) table.warnings.push("AMBIGUOUS_TABLE_MATCH");
    table.memberIds.push(block.id);
    table.lastRow = rowsToUse.at(-1) ?? table.lastRow;
    table.lastLocation = block.locations.at(-1);
    members.set(block.id, {
      table,
      rows: rowsToUse,
      continuation: possible.length === 1,
    });
  }

  const visible = blocks.filter((block) => block.type !== "whitespace");
  for (const table of tables) {
    const first = visible.findIndex((block) => block.id === table.memberIds[0]);
    for (const note of [visible[first - 1], visible[first + 1]]) {
      if (
        note?.type !== "paragraph" ||
        !/^(?:notes?|units?|amounts?|currency|all figures|figures are|values are)\b/i.test(
          note.rawText.trim(),
        ) ||
        note.sectionContext.readingOrderSectionIds.length !== 1 ||
        note.sectionContext.readingOrderSectionIds[0] !== table.sectionId
      )
        continue;
      table.notes.push({ text: note.rawText, locations: note.locations });
    }
  }
  const references = [];
  for (const section of sections) {
    const mentioned = new Set(
      section.parts.flatMap((part) =>
        [
          ...part.text.matchAll(/\bsection\s+(\d+[A-Z]?(?:\.\d+[A-Z]?)*)\b/gi),
        ].map((match) => match[1].toUpperCase()),
      ),
    );
    for (const part of section.parts) {
      for (const line of part.text.split(/\r?\n/)) {
        for (const match of line.matchAll(
          /\bsection\s+(\d+[A-Z]?(?:\.\d+[A-Z]?)*)\b/gi,
        )) {
          const candidates = labels.get(match[1].toUpperCase()) ?? [];
          const external =
            /\b(other|another|external)\s+(document|manual|handbook)\b/i.test(
              line,
            );
          const target =
            !external && candidates.length === 1 ? candidates[0] : null;
          if (target?.id === section.id) continue;
          const explains =
            /\b(explain\w*|column\w*|meanings?|definitions?|keys?)\b/i.test(
              line,
            );
          const reference = {
            sourceSectionId: section.id,
            targetSectionId: target?.id ?? null,
            targetLabel: match[1],
            relation: explains ? "explains" : "references",
            status: target ? "resolved" : "unresolved",
            evidence: { text: line, sourceSpan: part.sourceSpan },
          };
          references.push(reference);
          if (!target || !explains) continue;
          if (mentioned.size > 1) {
            reference.status = "unresolved";
            reference.reason = "MULTIPLE_EXPLANATION_TARGETS";
            continue;
          }
          const targets = tables.filter(
            (table) => table.sectionId === target.id,
          );
          if (targets.length !== 1) {
            reference.status = "unresolved";
            reference.reason = "TABLE_TARGET_NOT_UNIQUE";
            continue;
          }
          const table = targets[0];
          table.references.push(reference);
          for (const sourcePart of section.parts) {
            for (const definition of sourcePart.text.split(/\r?\n/)) {
              const parsed =
                /^\s*(?:[-*]\s+)?(?:Column\s+)?([^:=]{1,80})\s*[:=]\s*(.+)$/i.exec(
                  definition,
                );
              if (!parsed) continue;
              const indexes = table.header.cells.flatMap((cell, i) =>
                key(cell.text) === key(parsed[1]) ? [i] : [],
              );
              if (indexes.length !== 1) continue;
              const index = indexes[0];
              const existing = table.definitions[index];
              if (existing && existing.text !== parsed[2].trim()) {
                existing.conflict = true;
                table.warnings.push("CONFLICTING_COLUMN_DEFINITIONS");
              } else if (!existing) {
                table.definitions[index] = {
                  text: parsed[2].trim(),
                  sourceSpan: sourcePart.sourceSpan,
                };
              }
            }
          }
        }
      }
    }
  }
  return { tables, members, references, diagnostics, bySection };
}
~~~~

## src/services/token-packer.service.js

~~~~js
﻿import { measureEmbeddingInput } from "./embedding.service.js";

export async function packStructuralUnits(units, sections, identity, documentId, {
  measure = measureEmbeddingInput, parentTokenLimit = 1024, childTokenLimit = 256,
} = {}) {
  if (![parentTokenLimit, childTokenLimit].every((n) => Number.isSafeInteger(n) && n > 0) ||
      parentTokenLimit < childTokenLimit) {
    throw new TypeError("Expected positive token budgets, with parent >= child");
  }
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const cache = new Map();
  async function count(text) {
    if (!cache.has(text)) {
      const details = await measure(text);
      if (!Number.isSafeInteger(details.tokenCount) || details.tokenCount < 1 ||
          !Number.isSafeInteger(details.tokenLimit) || details.tokenLimit < 1) {
        throw new Error("Invalid tokenizer measurement");
      }
      if (cache.size >= 2048) cache.clear();
      cache.set(text, details);
    }
    return cache.get(text);
  }

  const groups = [];
  for (const unit of units) {
    const section = sectionMap.get(unit.sectionId);
    let prefix = "Document: " + identity.title +
      (section?.headingPath.length ? "\nSection: " + section.headingPath.join(" > ") : "");
    const limit = Math.min(childTokenLimit, (await count("")).tokenLimit);
    let compacted = false;
    if ((await count(prefix + "\n\n")).tokenCount > limit - 24) {
      prefix = "Document ID: " + documentId +
        (unit.sectionId ? "\nSection ID: " + unit.sectionId : "");
      compacted = true;
    }
    const groupKey = JSON.stringify([unit.sectionId, unit.locations[0].sourceId, unit.groupId, prefix]);
    let group = groups.at(-1);
    if (group?.key !== groupKey) {
      group = { key: groupKey, sectionId: unit.sectionId, prefix, compacted,
        childLimit: limit, pieces: [] };
      groups.push(group);
    }

    const render = (body, labels = unit.labels) =>
      [...labels, body].filter((value) => value !== "").join("\n");
    const search = (text) => prefix + "\n\n" + text;
    async function fits(text) {
      return (await count(search(text))).tokenCount <= limit;
    }
    function add(text, fragment = false) {
      group.pieces.push({ text, unit, fragment });
    }

    async function splitValue(value, renderValue) {
      if (await fits(renderValue(value))) {
        add(renderValue(value), true);
        return;
      }
      const chars = Array.from(value);
      if (chars.length <= 1) {
        const error = new Error("Required chunk context cannot fit the embedding budget");
        error.code = "CHUNK_CONTEXT_TOO_LARGE";
        error.details = { unitId: unit.id, blockId: unit.blockId, tokenLimit: limit };
        throw error;
      }
      // Prefer a whitespace boundary near the middle; otherwise preserve Unicode
      // code points. Every resulting piece is re-tokenized; counts need not be additive.
      const middle = Math.floor(chars.length / 2);
      let cut = middle;
      let found = false;
      for (const boundary of [
        (at) => chars[at] === "\n",
        (at) => /[.!?。！？]/u.test(chars[at - 1] ?? "") && /\s/u.test(chars[at]),
        (at) => /\s/u.test(chars[at]),
      ]) {
        for (let distance = 0; distance < Math.max(1, Math.floor(chars.length / 4)); distance++) {
          const at = middle - distance;
          if (at + 1 < chars.length && boundary(at)) {
            cut = at + 1; found = true; break;
          }
        }
        if (found) break;
      }
      await splitValue(chars.slice(0, cut).join(""), renderValue);
      await splitValue(chars.slice(cut).join(""), renderValue);
    }

    const complete = render(unit.text);
    if (await fits(complete)) {
      add(complete);
    } else if (unit.fields) {
      for (const field of unit.fields) {
        await splitValue(field.value, (value) => render(
          "Row identity: " + unit.rowAnchor + "\n" +
          field.label + ": " + value,
        ));
      }
    } else {
      await splitValue(unit.text, (value) => render(value));
    }
  }

  const packed = [];
  for (const group of groups) {
    let parentPieces = [];
    let children = [];
    let childPieces = [];
    const joined = (pieces) => pieces.map((piece) => piece.text).join("\n\n");
    const search = (pieces) => group.prefix + "\n\n" + joined(pieces);

    async function finishChild() {
      if (!childPieces.length) return;
      children.push({
        pieces: childPieces, text: joined(childPieces),
        searchText: search(childPieces), tokens: await count(search(childPieces)),
      });
      childPieces = [];
    }
    async function finishParent() {
      await finishChild();
      if (!parentPieces.length) return;
      packed.push({
        ...group, pieces: parentPieces, text: joined(parentPieces),
        searchText: search(parentPieces), children,
        tokenCount: (await count(search(parentPieces))).tokenCount,
        tokenLimit: parentTokenLimit,
      });
      parentPieces = [];
      children = [];
    }

    for (const piece of group.pieces) {
      if (parentPieces.length &&
          (await count(search([...parentPieces, piece]))).tokenCount > parentTokenLimit) {
        await finishParent();
      }
      if (childPieces.length &&
          (await count(search([...childPieces, piece]))).tokenCount > group.childLimit) {
        await finishChild();
      }
      parentPieces.push(piece);
      childPieces.push(piece);
    }
    await finishParent();
  }
  return packed;
}
~~~~

## src/services/extraction-normalizer.service.js

~~~~js
const EXTRACTION_VERSION = "extraction-v1";

const PARSER_SOURCE_KINDS = new Map([
  ["application/pdf", "page"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "rendered_page",
  ],
  ["image/jpeg", "image"],
  ["image/png", "image"],
  ["image/webp", "image"],
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateSource(source) {
  if (
    !isObject(source) ||
    typeof source.filename !== "string" ||
    !source.filename.trim() ||
    typeof source.mimetype !== "string" ||
    !source.mimetype.trim()
  ) {
    throw new TypeError("Source requires a filename and mimetype");
  }

  return {
    filename: source.filename,
    mimetype: source.mimetype,
  };
}

function readPageText(page, label) {
  for (const field of ["md", "text"]) {
    if (page[field] != null && typeof page[field] !== "string") {
      throw new TypeError(label + ": " + field + " must be a string");
    }
  }

  if (typeof page.md === "string" && page.md.trim()) {
    return {
      text: page.md,
      textFormat: "markdown",
    };
  }

  if (typeof page.text === "string" && page.text.trim()) {
    return {
      text: page.text,
      textFormat: "plain",
    };
  }

  if (typeof page.md === "string") {
    return {
      text: page.md,
      textFormat: "markdown",
    };
  }

  if (typeof page.text === "string") {
    return {
      text: page.text,
      textFormat: "plain",
    };
  }

  throw new Error(label + ": neither Markdown nor text was returned");
}

export function normalizeLlamaParseResult(results, source) {
  const checkedSource = validateSource(source);
  const sourceKind = PARSER_SOURCE_KINDS.get(checkedSource.mimetype);

  if (!sourceKind) {
    throw new Error("Unsupported parser input: " + checkedSource.mimetype);
  }

  // One upload must produce one parser result.
  if (
    !Array.isArray(results) ||
    results.length !== 1 ||
    !isObject(results[0])
  ) {
    throw new Error("Expected one LlamaParse result for one uploaded file");
  }

  const result = results[0];

  if (!Array.isArray(result.pages) || result.pages.length === 0) {
    throw new Error("LlamaParse returned no pages");
  }

  const seenPageNumbers = new Set();
  let previousPageNumber = 0;

  const pages = Array.from(result.pages, (page, index) => {
    const label = "Parser entry " + (index + 1);

    if (!isObject(page)) {
      throw new TypeError(label + ": expected a page object");
    }

    if (page.success === false || page.error) {
      throw new Error(label + ": parser reported a failure");
    }

    const parserPageNumber = page.page ?? null;

    if (
      parserPageNumber !== null &&
      (!Number.isSafeInteger(parserPageNumber) || parserPageNumber < 1)
    ) {
      throw new Error(label + ": invalid parser page number");
    }

    if (parserPageNumber !== null) {
      if (seenPageNumbers.has(parserPageNumber)) {
        throw new Error(label + ": duplicate parser page number");
      }

      if (parserPageNumber < previousPageNumber) {
        throw new Error(label + ": parser pages are out of order");
      }

      seenPageNumbers.add(parserPageNumber);
      previousPageNumber = parserPageNumber;
    }

    const { text, textFormat } = readPageText(page, label);

    if (page.items != null && !Array.isArray(page.items)) {
      throw new TypeError(label + ": items must be an array");
    }

    const warnings = [];

    if (parserPageNumber === null) {
      warnings.push("PAGE_NUMBER_UNAVAILABLE");
    }

    if (page.items == null) {
      warnings.push("PARSER_ITEMS_UNAVAILABLE");
    }

    if (!text.trim()) {
      warnings.push("EMPTY_EXTRACTED_TEXT");
    }

    if (textFormat === "plain") {
      warnings.push("PLAIN_TEXT_FALLBACK");
    }

    return {
      id: "source-" + (index + 1),
      sequenceIndex: index,
      sourceKind,
      parserPageNumber,
      sourcePageNumber: sourceKind === "page" ? parserPageNumber : null,
      text,
      textFormat,
      items: page.items == null ? null : structuredClone(page.items),
      warnings,
    };
  });

  if (!pages.some((page) => page.text.trim())) {
    throw new Error("Document contains no extracted text");
  }

  const warnings = [];
  const reportedPageCount = result.job_metadata?.job_pages;

  if (
    Number.isSafeInteger(reportedPageCount) &&
    reportedPageCount >= 0 &&
    reportedPageCount !== pages.length
  ) {
    warnings.push("REPORTED_PAGE_COUNT_MISMATCH");
  }

  return {
    schemaVersion: EXTRACTION_VERSION,
    source: checkedSource,
    provider: "llamaparse",
    jobId: typeof result.job_id === "string" ? result.job_id : null,
    pages,
    warnings,
    rawResult: structuredClone(result),
  };
}

export function normalizeTextDocument(text, source) {
  const checkedSource = validateSource(source);

  if (!["text/plain", "text/markdown"].includes(checkedSource.mimetype)) {
    throw new Error("Unsupported text input: " + checkedSource.mimetype);
  }

  if (typeof text !== "string") {
    throw new TypeError("Document text must be a string");
  }

  if (!text.trim()) {
    throw new Error("Document contains no extracted text");
  }

  return {
    schemaVersion: EXTRACTION_VERSION,
    source: checkedSource,
    provider: "native",
    jobId: null,
    pages: [
      {
        id: "source-1",
        sequenceIndex: 0,
        sourceKind: "document",
        parserPageNumber: null,
        sourcePageNumber: null,
        text,
        textFormat:
          checkedSource.mimetype === "text/markdown" ? "markdown" : "plain",
        items: null,
        warnings: ["PARSER_ITEMS_UNAVAILABLE"],
      },
    ],
    warnings: [],
    rawResult: { text },
  };
}
~~~~

## src/services/embedding.service.js

~~~~js
import { pipeline } from "@xenova/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export const INDEX_TOKEN_LIMIT = 256;

export function createEmbeddingService(
  loadPipeline = () => pipeline("feature-extraction", EMBEDDING_MODEL),
) {
  let pendingPipeline;

  function getPipeline() {
    if (!pendingPipeline) {
      pendingPipeline = Promise.resolve()
        .then(loadPipeline)
        .catch((error) => {
          pendingPipeline = undefined;
          throw error;
        });
    }

    return pendingPipeline;
  }

  function validateText(text) {
    if (typeof text !== "string") {
      throw new TypeError("Embedding input must be a string");
    }
  }

  async function measureEmbeddingInput(text) {
    validateText(text);

    const extractor = await getPipeline();

    const modelLimit = Number(extractor.tokenizer.model_max_length);

    if (!Number.isSafeInteger(modelLimit) || modelLimit < 1) {
      throw new Error("Embedding tokenizer has no valid model_max_length");
    }

    const tokens = await extractor.tokenizer(text, {
      add_special_tokens: true,
      truncation: false,
      padding: false,
    });

    const tokenCount = tokens.input_ids.data.length;

    const tokenLimit = Math.min(modelLimit, INDEX_TOKEN_LIMIT);

    return {
      model: EMBEDDING_MODEL,
      tokenCount,
      tokenLimit,
      withinLimit: tokenCount <= tokenLimit,
    };
  }

  async function getEmbedding(
    text,
    { rejectTruncation = false, onDetails } = {},
  ) {
    validateText(text);

    const extractor = await getPipeline();

    const details = rejectTruncation
      ? await measureEmbeddingInput(text)
      : { model: EMBEDDING_MODEL };

    if (rejectTruncation && !details.withinLimit) {
      if (onDetails) {
        await onDetails(details);
      }

      const error = new Error(
        "Chunk is too large for embedding: " + details.tokenCount + " tokens",
      );

      error.code = "EMBEDDING_INPUT_TOO_LARGE";
      error.details = details;

      throw error;
    }

    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    details.dimensions = output.data.length;

    if (onDetails) {
      await onDetails(details);
    }

    return Array.from(output.data);
  }

  return {
    measureEmbeddingInput,
    getEmbedding,
  };
}

const service = createEmbeddingService();

export const measureEmbeddingInput = service.measureEmbeddingInput;

export const getEmbedding = service.getEmbedding;
~~~~

## tests/structured-chunking.test.js

~~~~js
﻿import "./offline-embedding-setup.js";
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlamaParseResult, normalizeTextDocument } from "../src/services/extraction-normalizer.service.js";
import { buildDocumentChunks } from "../src/services/chunking.service.js";
import { measureEmbeddingInput } from "../src/services/embedding.service.js";
import { packStructuralUnits } from "../src/services/token-packer.service.js";

function pdf(...texts) {
  return normalizeLlamaParseResult(
    [{pages: texts.map((md, i) => ({page:i+1,md}))}],
    {filename:"handbook.pdf",mimetype:"application/pdf"},
  );
}
const build = (extraction, options) =>
  buildDocumentChunks(extraction,"document-1","handbook.pdf",()=>{},options);

test("splitting a short value with trailing whitespace always makes progress", async () => {
  const packed = await packStructuralUnits([{
    id: "short-unit", blockId: "short-block", text: "x ", labels: [],
    sectionId: null, groupId: "text", locations: [{ sourceId: "source-1" }],
  }], [], { title: "Example" }, "document-1", {
    // Model an over-budget value whose smaller pieces fit. Counts need not
    // be additive; the splitter must terminate independently of the tokenizer.
    measure: async (text) => ({
      tokenCount: text.endsWith("x ") ? 257 : 2, tokenLimit: 256,
    }),
  });
  assert.deepEqual(packed.flatMap((parent) => parent.pieces.map((piece) => piece.text)),
    ["x", " "]);
});

async function checkBudgets(parents) {
  for (const parent of parents) {
    assert.ok(parent.metadata.token_budget.tokenCount <= parent.metadata.token_budget.tokenLimit);
    for (const child of parent.children) {
      const count = await measureEmbeddingInput(child.searchText);
      assert.ok(count.withinLimit, child.searchText);
      assert.equal(count.tokenCount, child.metadata.token_budget.tokenCount);
      assert.ok(child.searchText.includes(child.text));
    }
  }
}

test("table values retain their distinct date and column labels in every child", async () => {
  const parents = await build(pdf(
    "# 1. Population\n\n| City | Census — 1 January 2022 | Metropolitan area — 31 December 2023 | City proper — 31 December 2023 |\n" +
    "| --- | --- | --- | --- |\n| Kettleby | 158,744 | 361,092 | 163,482 |",
  ));
  const children = parents.flatMap((parent) => parent.children);
  const row = children.find((child) => child.text.includes("163,482"));
  assert.ok(row.text.includes("City proper — 31 December 2023: 163,482"));
  assert.ok(row.text.includes("Census — 1 January 2022: 158,744"));
  assert.ok(row.text.includes("Metropolitan area — 31 December 2023: 361,092"));
  await checkBudgets(parents);
});

test("interrupted tables reconnect across pages and explicit definitions travel with values", async () => {
  const parents = await build(pdf(
    "# 5. Finance\n\n| Depot | B |\n| --- | --- |\n| D06 | 60 |\n| D07 | 70 |\n\n# 6. Pallets\n\nPallet standards.",
    "| D08 | 80 |\n| D09 | 90 |\n\n**5A. Column meanings**\n\n" +
    "This explains the column meanings in section 5.\n\nColumn B: Annual revenue (INR crore).",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Depot: D08"));
  assert.ok(row);
  assert.deepEqual(row.metadata.heading_path, ["5. Finance"]);
  assert.ok(row.text.includes("Annual revenue (INR crore)"));
  assert.ok(row.metadata.context_locations.some((loc) => loc.role === "column_definition"));
  assert.ok(row.metadata.relationships.some((item) => item.status === "inferred"));
  assert.ok(parents.some((parent) => parent.text.includes("Explanation for table:")));
  await checkBudgets(parents);
});

test("ambiguous continuation candidates are not silently joined", async () => {
  const parents = await build(pdf(
    "# 1. First\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 70 |\n\n" +
    "# 2. Second\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 99 |",
    "| D08 | 80 |\n| D09 | 90 |",
  ));
  const row = parents.find((parent) => parent.text.includes("D08"));
  assert.deepEqual(row.metadata.heading_path, []);
  assert.ok(row.searchText.includes("column meanings unavailable"));
  assert.ok(row.metadata.relationships.some((item) => item.reason === "AMBIGUOUS_TABLE_MATCH"));
});

test("a 19-item list stays in one parent when its parent budget permits", async () => {
  const parents = await build(pdf("# 1. Activities\n\n" +
    Array.from({length:19},(_,i)=>(i+1)+". Workshop activity "+(i+1)+".").join("\n")));
  const list = parents.filter((parent) => parent.metadata.list_item_ids.length);
  assert.equal(list.length, 1);
  assert.equal(list[0].metadata.list_item_ids.length, 19);
  for (const child of list[0].children) {
    assert.equal(child.metadata.contains_unit_fragments, false);
  }
  await checkBudgets(parents);
});

test("oversized rows split into labelled cells and long values retain row identity", async () => {
  const detail = "Long description. ".repeat(350);
  const parents = await build(pdf(
    "# 1. Records\n\n| ID | Description | Count |\n| --- | --- | --- |\n| R01 | " +
    detail + " | 42 |",
  ));
  const fragments = parents.flatMap((parent) => parent.children)
    .filter((child) => child.metadata.row_ids.length);
  assert.ok(fragments.length > 1);
  for (const child of fragments) assert.ok(child.text.includes("Row identity: ID: R01"));
  assert.ok(fragments.some((child) => child.text.includes("Count: 42")));
  assert.equal(fragments.map((child) => child.text).join("").match(/Long description\./g).length, 350);
  await checkBudgets(parents);
});

test("Unicode text is split without data loss and long context is compacted visibly", async () => {
  const text = "你好世界🧭 ".repeat(600);
  const extraction = normalizeTextDocument(text, {
    filename: "long filename ".repeat(200) + ".txt", mimetype:"text/plain",
  });
  const parents = await build(extraction);
  const rendered = parents.flatMap((parent) => parent.children).map((child) => child.text).join("");
  assert.equal(rendered.replace(/\s/g,""), text.replace(/\s/g,""));
  assert.ok(parents.every((parent) => parent.metadata.context_compacted));
  await checkBudgets(parents);
});

test("numbered sibling repair and unresolved headings survive integration", async () => {
  const parents = await build(pdf(
    "### 17. Equipment\n\nEquipment.\n\n#### 18. Safety\n\nSafety.\n\n**ACTIVITIES**\n\nWorkshops.",
  ));
  const safety = parents.find((parent) => parent.text.includes("Safety."));
  assert.deepEqual(safety.metadata.heading_path, ["18. Safety"]);
  const activities = parents.find((parent) => parent.text.includes("Workshops."));
  assert.deepEqual(activities.metadata.heading_path, []);
  assert.equal(activities.metadata.section_structure.review_required, true);
});

test("code fences and unsupported HTML remain source content", async () => {
  const parents = await build(pdf(
    "# 1. Examples\n\n````md\n# Hidden",
    "```\n# Still hidden\n````\n\n<table><tr><td>VALUE</td></tr></table>",
  ));
  assert.ok(parents.some((parent) => parent.text.includes("# Still hidden")));
  assert.ok(parents.some((parent) => parent.text.includes("<td>VALUE</td>")));
  assert.ok(parents.every((parent) => !parent.metadata.heading_path.some((title) => title.includes("Hidden"))));
  await checkBudgets(parents);
});

test("oversized mandatory column context produces a diagnostic instead of truncated values", async () => {
  const label = "important column meaning ".repeat(400);
  await assert.rejects(() => build(pdf(
    "# 1. Data\n\n| ID | " + label + " |\n| --- | --- |\n| X01 | 7 |",
  )), (error) => error.code === "CHUNK_CONTEXT_TOO_LARGE");
});

test("explicit references resolve uniquely; duplicate section labels remain ambiguous", async () => {
  const parents = await build(pdf(
    "# 1. First\n\nOne.\n\n# Chapter B\n\nText.\n\n## 1. Other\n\nOther.\n\n" +
    "# 2. Links\n\nSee section 1.",
  ));
  const refs = parents.flatMap((parent) => parent.metadata.references);
  assert.ok(refs.some((ref) => ref.targetLabel === "1" && ref.status === "unresolved"));
});

test("adjacent unit notes are repeated with table values", async () => {
  const parents = await build(pdf(
    "# 1. Rates\n\nUnits: INR crore, year ending 2025.\n\n" +
    "| Depot | Amount |\n| --- | --- |\n| D01 | 25 |",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Depot: D01"));
  assert.ok(row.text.includes("Units: INR crore, year ending 2025."));
});

test("chunk links remain within sections and output is JSON serializable", async () => {
  const parents = await build(pdf(
    "# 1. First\n\n" + "Alpha details. ".repeat(500) + "\n\n# 2. Next\n\nBeta.",
  ), {parentTokenLimit:400});
  const map = new Map(parents.map((parent) => [parent.id,parent]));
  for (const parent of parents) {
    if (parent.nextParentId) {
      const next = map.get(parent.nextParentId);
      assert.equal(next.prevParentId, parent.id);
      assert.equal(next.metadata.section_id, parent.metadata.section_id);
    }
  }
  assert.doesNotThrow(() => JSON.stringify(parents));
  await checkBudgets(parents);
});


test("cover identity survives changing section headings", async () => {
  const parents = await build(pdf(
    "# TESSALY PARCEL NETWORK\n\n## DEPOT HANDBOOK TPN-SH-2026-10",
    "### 17. Equipment\n\nDetails.\n\n#### 18. Safety\n\nSafety text.",
  ));
  const safety = parents.find((parent) => parent.text.includes("Safety text."));
  assert.equal(safety.metadata.document_identity.status, "inferred");
  assert.equal(safety.metadata.document_identity.titleSource, "opening_cover");
  assert.equal(safety.metadata.document_title,
    "TESSALY PARCEL NETWORK \u2014 DEPOT HANDBOOK TPN-SH-2026-10");
  assert.ok(safety.searchText.includes("DEPOT HANDBOOK TPN-SH-2026-10"));
  assert.deepEqual(safety.metadata.heading_path, ["18. Safety"]);
});

test("conflicting column definitions remain flagged rather than replacing labels", async () => {
  const parents = await build(pdf(
    "# 5. Rates\n\n| Depot | B |\n| --- | --- |\n| D01 | 50 |\n\n" +
    "## 5A. Key\n\nColumn meanings for section 5.\n\nColumn B: Revenue.\nColumn B: Population.",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Depot: D01"));
  assert.ok(row.metadata.structure_warnings.includes("CONFLICTING_COLUMN_DEFINITIONS"));
  assert.ok(row.text.includes("B: 50"));
  assert.ok(!row.text.includes("B — Revenue: 50"));
});

test("a continuation with incompatible value types stays unresolved", async () => {
  const parents = await build(pdf(
    "# 5. Rates\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 50 |",
    "| D08 | Open |\n| D09 | Closed |",
  ));
  const row = parents.find((parent) => parent.text.includes("D08"));
  assert.ok(row.searchText.includes("Unresolved table fragment"));
});

test("a note explaining two different tables is not assigned wholesale to either", async () => {
  const parents = await build(pdf(
    "# 1. First\n\n| ID | B |\n| --- | --- |\n| D01 | 10 |\n\n" +
    "# 2. Second\n\n| ID | B |\n| --- | --- |\n| E01 | 20 |\n\n" +
    "# 3. Meanings\n\nColumn meanings for section 1 and section 2.\n\nColumn B: Ambiguous meaning.",
  ));
  assert.ok(parents.flatMap((parent) => parent.metadata.references)
    .some((reference) => reference.reason === "MULTIPLE_EXPLANATION_TARGETS"));
  const first = parents.find((parent) => parent.text.includes("ID: D01"));
  assert.ok(!first.text.includes("B — Ambiguous meaning"));
});

test("nested table rows retain column labels and their list context", async () => {
  const parents = await build(pdf(
    "# 1. Tasks\n\n1. Check the following values.\n\n" +
    "   | Name | Count |\n   | --- | --- |\n   | Alpha | 42 |",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("Name: Alpha"));
  assert.ok(row.text.includes("Item: 1."));
  assert.ok(row.text.includes("Count: 42"));
  await checkBudgets(parents);
});


test("headerless text values preserve literal backslashes", async () => {
  const parents = await build(pdf(
    "# 1. Paths\n\n| ID | Path |\n| --- | --- |\n| D07 | C:\\old |",
    "| D08 | C:\\data |\n| D09 | C:\\next |",
  ));
  const row = parents.flatMap((parent) => parent.children).find((child) => child.text.includes("ID: D08"));
  assert.ok(row.text.includes("C:\\data"));
});

test("generated children embed through the shared real model", async () => {
  const { getEmbedding } = await import("../src/services/embedding.service.js");
  const parents = await build(pdf("# 1. Facts\n\nA short source passage."));
  const vector = await getEmbedding(parents[0].children[0].searchText, {rejectTruncation:true});
  assert.equal(vector.length,384);
  assert.ok(Math.abs(Math.sqrt(vector.reduce((sum,value)=>sum+value*value,0))-1)<0.0001);
});

test("budget failures are reported with a unit diagnostic", async () => {
  const events=[];
  await assert.rejects(() => buildDocumentChunks(
    pdf("# 1. Values\n\n| ID | "+ "long header ".repeat(600)+" |\n| --- | --- |\n| X01 | 4 |"),
    "document-1", "handbook.pdf", event=>events.push(event),
  ), error=>error.code==="CHUNK_CONTEXT_TOO_LARGE");
  assert.ok(events.some(event=>event.type==="chunking_failed" && event.details.unitId));
});
~~~~

## tests/document-blocks.test.js

~~~~js
﻿import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeLlamaParseResult,
  normalizeTextDocument,
} from "../src/services/extraction-normalizer.service.js";
import { buildDocumentSections } from "../src/services/document-sections.service.js";
import { collectDocumentBlocks } from "../src/services/document-blocks.service.js";

function pdf(...texts) {
  return normalizeLlamaParseResult(
    [{ pages: texts.map((md, index) => ({ page: index + 1, md })) }],
    { filename: "guide.pdf", mimetype: "application/pdf" },
  );
}

async function inspect(extraction) {
  const { sections } = await buildDocumentSections(extraction);
  return { sections, result: collectDocumentBlocks(extraction, sections) };
}

test("retains table labels, dates, units, escaped pipes and rows", async () => {
  const { result } = await inspect(pdf(
    "# 5. Population\n\n" +
    "| City | City proper — 31 December 2023 (people) |\n" +
    "| --- | ---: |\n| Kettleby | 163,482 |\n| A\\|B | 200 |",
  ));
  const table = result.blocks.find((block) => block.type === "table");
  assert.equal(table.table.header.cells[1].text,
    "City proper — 31 December 2023 (people)");
  assert.equal(table.table.rows[0].cells[1].text, "163,482");
  assert.equal(table.table.rows[1].cells[0].text, "A|B");
  assert.equal(table.table.rows.length, 2);
  assert.equal(table.sectionContext.ownershipStatus, "unresolved");
});

test("retains every list item and the actual source markers", async () => {
  const { result } = await inspect(pdf(
    "# 1. Activities\n\n1. First item.\n\n   More detail.\n\n" +
    "   - Nested item.\n\n3. Third-numbered item.",
  ));
  const list = result.blocks.find((block) => block.type === "list");
  assert.equal(list.list.items.length, 2);
  assert.equal(list.list.items[1].item.marker, "3.");
  assert.ok(list.list.items[0].rawText.includes("More detail."));
  assert.ok(list.list.items[0].item.blocks.some((block) => block.type === "list"));

  const many = await inspect(pdf("# 1. Events\n\n" +
    Array.from({ length: 19 }, (_, i) => (i + 1) + ". Event " + (i + 1)).join("\n")));
  assert.equal(many.result.blocks.find((block) => block.type === "list").list.items.length, 19);
});

test("top-level block locations cover original sources exactly", async () => {
  const extraction = pdf(
    "# 1. Examples\r\n\r\n🧭 Notes.\r\n\r\n````md\r\n# Hidden",
    "",
    "```\n# Still hidden\n````\n\nEnd.\n",
  );
  const { result } = await inspect(extraction);

  for (const page of extraction.pages) {
    const locations = result.blocks.flatMap((block) => block.locations)
      .filter((location) => location.sourceId === page.id);
    let cursor = 0;
    let text = "";
    for (const location of locations) {
      assert.equal(location.startOffset, cursor);
      text += page.text.slice(location.startOffset, location.endOffset);
      cursor = location.endOffset;
    }
    assert.equal(cursor, page.text.length);
    assert.equal(text, page.text);
  }
  const code = result.blocks.find((block) => block.type === "code");
  assert.equal(code.containsInsertedSeparators, true);
  assert.equal(code.locations.length, 2);
});

test("retains a headerless continuation without assigning semantic ownership", async () => {
  const { result } = await inspect(pdf(
    "# 5. Finance\n\n| Depot | Amount |\n| --- | --- |\n| D07 | 70 |\n\n" +
    "# 6. Pallets\n\nPallet standards.",
    "| D08 | 80 |\n| D09 | 90 |",
  ));
  const fragment = result.blocks.find((block) => block.rawText.includes("D08"));
  assert.ok(fragment.warnings.includes("POSSIBLE_TABLE_FRAGMENT"));
  assert.equal(fragment.sectionContext.ownershipStatus, "unresolved");
  assert.equal(result.blocks.filter((block) => block.type === "table").length, 1);
});

test("retains HTML and plain text without inventing table structure", async () => {
  const html = await inspect(pdf(
    "<table>\n<tr><td>A</td><td>10</td></tr>\n</table>",
  ));
  assert.equal(html.result.blocks[0].type, "raw");
  assert.ok(html.result.blocks[0].warnings.includes("UNSUPPORTED_BLOCK_RETAINED"));

  const text = normalizeTextDocument(
    "TITLE\n\nordinary text\n\nDETAILS\n\nA | B",
    { filename: "notes.txt", mimetype: "text/plain" },
  );
  const plain = await inspect(text);
  assert.equal(plain.result.blocks.length, 1);
  assert.equal(plain.result.blocks[0].rawText, text.pages[0].text);
  assert.equal(plain.result.blocks[0].sectionContext.crossesSectionBoundary, true);
});

test("flags empty headers and malformed row widths without dropping raw text", async () => {
  const markdown = "| City | |\n| --- | --- |\n| A | 10 | EXTRA |\n| B |";
  const { result } = await inspect(pdf(markdown));
  const table = result.blocks.find((block) => block.type === "table");
  assert.ok(table.warnings.includes("EMPTY_COLUMN_LABEL"));
  assert.ok(table.warnings.includes("TABLE_ROW_WIDTH_MISMATCH"));
  assert.equal(table.rawText, markdown);
});

test("rejects section plans with stale text or incomplete source coverage", async () => {
  const extraction = pdf("# 1. Topic\n\nBody.");
  const { sections } = await buildDocumentSections(extraction);
  const stale = structuredClone(sections);
  stale[0].parts[0].text = "Changed";
  assert.throws(() => collectDocumentBlocks(extraction, stale), /does not match/);
  assert.throws(() => collectDocumentBlocks(extraction, []), /incomplete/);
});

test("does not modify extraction or section input", async () => {
  const extraction = pdf("| A | B |\n| --- | --- |\n| x | y |");
  const { sections } = await buildDocumentSections(extraction);
  const before = structuredClone({ extraction, sections });
  const result = collectDocumentBlocks(extraction, sections);
  result.blocks[0].locations[0].startOffset = 999;
  result.blocks[0].sectionContext.readingOrderSectionIds.length = 0;
  assert.deepEqual({ extraction, sections }, before);
});

test("flags grouping of lists across sources as unconfirmed", async () => {
  const { result } = await inspect(pdf(
    "# 1. Tasks\n\n1. First item.",
    "2. Second item.",
  ));
  const list = result.blocks.find((block) => block.type === "list");
  assert.equal(list.list.items.length, 2);
  assert.ok(list.warnings.includes("CROSS_SOURCE_LIST_GROUPING_UNCONFIRMED"));
});
~~~~

## tests/document-identity.test.js

~~~~js
﻿import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlamaParseResult } from "../src/services/extraction-normalizer.service.js";
import { collectHeadingCandidates } from "../src/services/heading-candidates.service.js";
import { buildDocumentIdentity } from "../src/services/document-identity.service.js";

function inspect(...pages) {
  const extraction = normalizeLlamaParseResult(
    [{
      pages: pages.map((md, index) => ({ page: index + 1, md })),
    }],
    { filename: "handbook.pdf", mimetype: "application/pdf" },
  );
  const headings = collectHeadingCandidates(extraction);

  return {
    extraction,
    headings,
    identity: buildDocumentIdentity(extraction, headings),
  };
}

test("collects opening title lines separately from numbered sections", () => {
  const { identity } = inspect(
    "# TESSALY PARCEL NETWORK\n\n" +
    "## DEPOT HANDBOOK TPN-SH-2026-10\n\n" +
    "### 1. OVERVIEW\n\nOpening text.",
    "# 7. DOCK EQUIPMENT MAINTENANCE\n\nMaintenance text.",
  );

  assert.equal(identity.title, "handbook.pdf");
  assert.equal(identity.titleSource, "filename");
  assert.equal(identity.status, "fallback");
  assert.deepEqual(identity.proposal.parts.map((part) => part.text), [
    "TESSALY PARCEL NETWORK",
    "DEPOT HANDBOOK TPN-SH-2026-10",
  ]);
  assert.equal(identity.proposal.status, "unresolved");
});

test("does not promote an ambiguous first heading to a confirmed title", () => {
  const { identity } = inspect("# Introduction\n\nSome body text.");
  assert.equal(identity.title, "handbook.pdf");
  assert.equal(identity.proposal.text, "Introduction");
  assert.ok(identity.warnings.includes("DOCUMENT_TITLE_UNCONFIRMED"));
});

test("lists, quotes, numbered headings and body text stop title inference", () => {
  for (const markdown of [
    "1. Complete the form.\n2. Submit it.",
    "> # Quoted title",
    "# 1. OVERVIEW",
    "Opening body text.\n\n# Later section",
    "```md\n# Example title\n```\n\n# Later section",
  ]) {
    assert.equal(inspect(markdown).identity.proposal, null);
  }
});

test("does not append later headings after body text or a source boundary", () => {
  const { identity } = inspect(
    "# Guide\n\nBody text.\n\n## Another section",
    "# Other document",
  );
  assert.deepEqual(identity.proposal.parts.map((part) => part.text), ["Guide"]);
});

test("retains real source locations after a blank source", () => {
  const { extraction, identity } = inspect(
    "",
    "Guide\r\n=====\r\n\r\n## 🧭 Navigation\r\n\r\nBody.",
  );
  for (const part of identity.proposal.parts) {
    const location = part.locations[0];
    assert.equal(location.sourceId, "source-2");
    assert.equal(location.sourcePageNumber, 2);
    assert.ok(
      extraction.pages[1].text
        .slice(location.startOffset, location.endOffset)
        .includes(part.text),
    );
  }
});

test("does not mutate or share proposal locations with collector output", () => {
  const { extraction, headings } = inspect("# Guide\n\nBody.");
  const before = structuredClone({ extraction, headings });
  const identity = buildDocumentIdentity(extraction, headings);
  identity.proposal.parts[0].locations[0].startOffset = 999;
  assert.deepEqual({ extraction, headings }, before);
});

test("rejects stale candidate offsets or text", () => {
  const { extraction, headings } = inspect("# Guide\n\nBody.");
  headings.candidates[0].rawText = "# Different title";
  assert.throws(
    () => buildDocumentIdentity(extraction, headings),
    /does not match its source/,
  );
});
~~~~

## tests/chunk-source-metadata.test.js

~~~~js
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
~~~~

## tests/heading-structure.test.js

~~~~js
﻿import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLlamaParseResult } from "../src/services/extraction-normalizer.service.js";
import { collectHeadingCandidates } from "../src/services/heading-candidates.service.js";
import { buildDocumentIdentity } from "../src/services/document-identity.service.js";
import { normalizeHeadingStructure } from "../src/services/heading-structure.service.js";

function inspect(markdown) {
  const extraction = normalizeLlamaParseResult(
    [{ pages: [{ page: 1, md: markdown }] }],
    { filename: "guide.pdf", mimetype: "application/pdf" },
  );
  const candidates = collectHeadingCandidates(extraction);
  const identity = buildDocumentIdentity(extraction, candidates);
  return {
    candidates,
    identity,
    result: normalizeHeadingStructure(candidates, identity),
  };
}

function numbered(result, label) {
  return result.decisions.find((item) => item.numbering?.label === label);
}

test("17 and 18 become siblings despite conflicting Markdown levels", () => {
  const { result } = inspect(
    "# Guide\n\n### 17. Equipment\n\nBody.\n\n#### 18. Safety",
  );
  const a = numbered(result, "17");
  const b = numbered(result, "18");
  assert.equal(a.depth, 1);
  assert.equal(b.depth, 1);
  assert.equal(b.parentCandidateId, a.parentCandidateId);
  assert.ok(b.warnings.includes("MARKDOWN_LEVEL_CONFLICT"));
  assert.equal(result.identity.title, "Guide");
  assert.equal(result.identity.titleSource, "filename_match");
});

test("bold 5A follows 5 as a sibling, without becoming a reference link", () => {
  const { result } = inspect(
    "## 5. Finance\n\nBody.\n\n**5A. Column meanings**\n\nExplanation.\n\n# 6. Pallets",
  );
  const headings = ["5", "5A", "6"].map((label) => numbered(result, label));
  assert.ok(headings.every((item) => item.status === "inferred"));
  assert.ok(
    headings.every(
      (item) => item.depth === 1 && item.parentCandidateId === null,
    ),
  );
});

test("decimal sections use their active numbered parent", () => {
  const { result } = inspect(
    "# 5. Finance\n\nBody.\n\n# 5.1 Rates\n\nBody.\n\n#### 5.2 Charges",
  );
  const parent = numbered(result, "5");
  for (const label of ["5.1", "5.2"]) {
    assert.equal(numbered(result, label).parentCandidateId, parent.id);
    assert.equal(numbered(result, label).depth, 2);
  }
});

test("a missing decimal parent and a numbering restart require review", () => {
  const missing = inspect(
    "# 17. Equipment\n\nBody.\n\n## 18.2 Exceptions",
  ).result;
  assert.equal(numbered(missing, "18.2").status, "unresolved");
  assert.equal(numbered(missing, "18.2").depth, null);
  const restart = inspect("# 2. Earlier\n\nBody.\n\n## 1. Restart").result;
  assert.ok(
    numbered(restart, "1").reasons.includes("NUMBERING_RESTART_OR_DUPLICATE"),
  );
});

test("numbered list items and quoted headings remain content", () => {
  const { result } = inspect(
    "# 5. Finance\n\n1. Complete the form.\n2. Submit the form.\n\n> # Quoted heading\n\n## 6. Pallets",
  );
  const nested = result.decisions.filter((item) =>
    item.containers.some((type) => type !== "root"),
  );
  assert.equal(nested.length, 3);
  assert.ok(
    nested.every((item) => item.role === "content" && item.depth === null),
  );
  assert.equal(numbered(result, "6").depth, 1);
});

test("an explicit chapter boundary scopes restarted numbering", () => {
  const { result } = inspect(
    "Preamble.\n\n# Chapter A\n\nText.\n\n## 1. First\n\nText.\n\n" +
      "# Chapter B\n\nText.\n\n## 1. Second",
  );
  const first = result.decisions.find((item) => item.title === "1. First");
  const second = result.decisions.find((item) => item.title === "1. Second");
  const chapterB = result.decisions.find((item) => item.title === "Chapter B");
  assert.notEqual(first.parentCandidateId, second.parentCandidateId);
  assert.equal(second.parentCandidateId, chapterB.id);
  assert.equal(second.status, "inferred");
});

test("unsupported bold headings and title proposals remain unresolved", () => {
  const { result } = inspect(
    "# Unconfirmed title\n\nBody.\n\n**COURSE FEES**\n\nFees.\n\n**VARIOUS DEVELOPMENTAL ACTIVITIES**",
  );
  assert.equal(result.decisions[0].role, "title_candidate");
  assert.ok(result.decisions.every((item) => item.status === "unresolved"));
  assert.equal(result.reviewCandidateIds.length, 3);
});

test("does not mutate input or guess a parent after a bold numbered heading", () => {
  const { candidates, identity, result } = inspect(
    "# 5. Finance\n\nBody.\n\n**5A. Details**\n\nBody.\n\n### Notes",
  );
  const before = structuredClone({ candidates, identity });
  const again = normalizeHeadingStructure(candidates, identity);
  again.identity.title = "changed";
  again.decisions[0].locations[0].startOffset = 999;
  assert.deepEqual({ candidates, identity }, before);
  const notes = result.decisions.at(-1);
  assert.equal(notes.status, "unresolved");
  assert.ok(notes.reasons.includes("MARKDOWN_PARENT_LEVEL_UNAVAILABLE"));
});
~~~~

## tests/extraction-normalizer.test.js

~~~~js
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
~~~~

## tests/embedding.service.test.js

~~~~js
﻿import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddingService } from "../src/services/embedding.service.js";

// This test tokenizer gives one token per code point plus two special tokens.
// Production uses the real model tokenizer; this fake makes boundaries exact.
function fixture(modelLimit = 256) {
  const calls = { loads: 0, tokenizations: [], embeddings: [] };

  const extractor = async (text, options) => {
    calls.embeddings.push({ text, options });
    return { data: new Float32Array(384) };
  };

  extractor.tokenizer = async (text, options) => {
    calls.tokenizations.push({ text, options });
    return { input_ids: { data: new BigInt64Array([...text].length + 2) } };
  };
  extractor.tokenizer.model_max_length = modelLimit;

  const service = createEmbeddingService(async () => {
    calls.loads++;
    return extractor;
  });

  return { service, calls, extractor };
}

test("measures the full input with special tokens and no truncation", async () => {
  const { service, calls } = fixture();
  const text = "Document: guide.pdf\nSection: 5. Rates\n\nFee: 25";
  const details = await service.measureEmbeddingInput(text);
  assert.equal(details.tokenCount, [...text].length + 2);
  assert.deepEqual(calls.tokenizations[0], {
    text,
    options: { add_special_tokens: true, truncation: false, padding: false },
  });
});

test("counts the complete contextual input instead of just the passage", async () => {
  const { service } = fixture();
  assert.equal((await service.measureEmbeddingInput("x".repeat(250))).withinLimit, true);
  assert.equal((await service.measureEmbeddingInput(
    "Document: guide.pdf\n\n" + "x".repeat(250),
  )).withinLimit, false);
});

test("accepts exactly the limit and rejects one token over before inference", async () => {
  const { service, calls } = fixture();
  const vector = await service.getEmbedding("x".repeat(254), { rejectTruncation: true });
  assert.equal(vector.length, 384);

  let reported;
  await assert.rejects(
    () => service.getEmbedding("x".repeat(255), {
      rejectTruncation: true,
      onDetails: (details) => { reported = details; },
    }),
    (error) => error.code === "EMBEDDING_INPUT_TOO_LARGE" &&
      error.details.tokenCount === 257,
  );
  assert.equal(calls.embeddings.length, 1);
  assert.equal(reported.withinLimit, false);
});

test("uses the lower of the tokenizer limit and the indexing limit", async () => {
  const smaller = fixture(128);
  const larger = fixture(512);
  assert.equal((await smaller.service.measureEmbeddingInput("text")).tokenLimit, 128);
  assert.equal((await larger.service.measureEmbeddingInput("text")).tokenLimit, 256);
});

test("shares one model load across simultaneous measurement and embedding", async () => {
  const { service, calls } = fixture();
  await Promise.all([
    service.measureEmbeddingInput("first"),
    service.measureEmbeddingInput("second"),
    service.getEmbedding("third", { rejectTruncation: true }),
  ]);
  assert.equal(calls.loads, 1);
  assert.deepEqual(calls.embeddings[0].options, {
    pooling: "mean", normalize: true,
  });
});

test("can retry loading after a failed initialization", async () => {
  const { extractor } = fixture();
  let attempts = 0;
  const service = createEmbeddingService(async () => {
    if (++attempts === 1) throw new Error("Load failed");
    return extractor;
  });
  await assert.rejects(() => service.measureEmbeddingInput("text"), /Load failed/);
  assert.equal((await service.measureEmbeddingInput("text")).withinLimit, true);
  assert.equal(attempts, 2);
});

test("rejects invalid text and invalid tokenizer limits", async () => {
  const { service, calls } = fixture();
  await assert.rejects(() => service.measureEmbeddingInput(null), /must be a string/);
  assert.equal(calls.loads, 0);
  const invalid = fixture(0);
  await assert.rejects(
    () => invalid.service.measureEmbeddingInput("text"),
    /model_max_length/,
  );
});

test("keeps the existing default query path and reports vector dimensions", async () => {
  const { service, calls } = fixture();
  let reported;
  await service.getEmbedding("query", {
    onDetails: (details) => { reported = details; },
  });
  assert.equal(calls.tokenizations.length, 0);
  assert.equal(reported.dimensions, 384);
});
~~~~

## src/services/heading-structure.service.js

~~~~js
function numberingParts(candidate) {
  return (
    candidate.numbering?.parts.map(
      (part) => part.toUpperCase(),
    ) ?? []
  );
}

function family(parts) {
  return parts.slice(0, -1).join(".");
}

function siblingOrder(previous, current) {
  const read = (part) => {
    const match = /^(\d+)([A-Z]?)$/.exec(part);

    return match
      ? [BigInt(match[1]), match[2]]
      : null;
  };

  const a = read(previous.at(-1));
  const b = read(current.at(-1));

  if (!a || !b) {
    return "unknown";
  }

  if (b[0] === a[0]) {
    const suffix = (value) =>
      value ? value.charCodeAt(0) - 64 : 0;

    const difference = suffix(b[1]) - suffix(a[1]);

    return difference === 1
      ? "next"
      : difference > 1
        ? "forward"
        : "restart";
  }

  if (b[0] === a[0] + 1n && b[1] === "") {
    return "next";
  }

  return b[0] > a[0] ? "forward" : "restart";
}

export function normalizeHeadingStructure(
  headingResult,
  identity,
) {
  if (
    headingResult?.version !== "heading-candidates-v1" ||
    !Array.isArray(headingResult.candidates) ||
    identity?.version !== "document-identity-v1"
  ) {
    throw new TypeError(
      "Expected heading candidates and document identity",
    );
  }

  const titleIds = new Set(
    identity.proposal?.parts.map(
      (part) => part.candidateId,
    ) ?? [],
  );

  const decisions = [];
  const stack = [];
  const ids = new Set();

  for (const candidate of headingResult.candidates) {
    if (!candidate.id || ids.has(candidate.id)) {
      throw new TypeError(
        "Heading candidate IDs must be unique",
      );
    }

    ids.add(candidate.id);

    const decision = {
      ...structuredClone(candidate),
      role: "unresolved",
      status: "unresolved",
      parentCandidateId: null,
      depth: null,
      reasons: [],
    };

    decisions.push(decision);

    const unresolved = (reason) => {
      decision.reasons.push(reason);

      // Do not infer later ancestry through
      // an uncertain boundary.
      stack.length = 0;
    };

    if (
      candidate.containers.some(
        (type) => type !== "root",
      )
    ) {
      decision.role = "content";
      decision.status = "retained";
      decision.reasons.push("NESTED_CONTENT_CONTEXT");
      continue;
    }

    if (candidate.kind === "ordered_list_item") {
      decision.role = "content";
      decision.status = "retained";
      decision.reasons.push("ORDERED_LIST_CONTEXT");
      continue;
    }

    if (identity.acceptedCandidateIds?.includes(candidate.id)) {
      decision.role = "document_title";
      decision.status = "retained";
      decision.reasons.push("DOCUMENT_IDENTITY_EVIDENCE");
      stack.length = 0;
      continue;
    }

    if (titleIds.has(candidate.id)) {
      decision.role = "title_candidate";
      unresolved("DOCUMENT_TITLE_UNCONFIRMED");
      continue;
    }

    if (
      !candidate.title.trim() ||
      candidate.locations.length !== 1
    ) {
      unresolved("HEADING_REQUIRES_REVIEW");
      continue;
    }

    const parts = numberingParts(candidate);

    const peer = parts.length
      ? stack.findLast(
          (entry) =>
            entry.parts.length === parts.length &&
            family(entry.parts) === family(parts),
        )
      : null;

    const order = peer
      ? siblingOrder(peer.parts, parts)
      : null;

    const explicit =
      candidate.kind === "markdown_heading";

    // Bold formatting plus an active consecutive
    // numbering pattern can support a candidate.
    const supportedHeuristic =
      candidate.kind === "standalone_bold" &&
      order === "next";

    if (!explicit && !supportedHeuristic) {
      unresolved("INSUFFICIENT_HEADING_EVIDENCE");
      continue;
    }

    decision.role = "section";

    if (
      peer &&
      !["next", "forward"].includes(order)
    ) {
      unresolved("NUMBERING_RESTART_OR_DUPLICATE");
      continue;
    }

    let parent = null;

    if (parts.length > 1) {
      const parentLabel = parts
        .slice(0, -1)
        .join(".");

      parent = stack.findLast(
        (entry) =>
          entry.parts.join(".") === parentLabel,
      );

      if (!parent) {
        unresolved("NUMBERED_PARENT_NOT_ACTIVE");
        continue;
      }

      decision.reasons.push(
        "EXPLICIT_NUMBERED_PARENT",
      );
    } else if (peer) {
      parent =
        stack.find(
          (entry) =>
            entry.decision.id ===
            peer.decision.parentCandidateId,
        ) ?? null;

      decision.reasons.push(
        "NUMBERED_SIBLING_PATTERN",
      );
    } else {
      if (
        stack.some(
          (entry) =>
            entry.decision.originalLevel === null,
        )
      ) {
        unresolved(
          "MARKDOWN_PARENT_LEVEL_UNAVAILABLE",
        );
        continue;
      }

      parent =
        stack.findLast(
          (entry) =>
            Number.isInteger(
              entry.decision.originalLevel,
            ) &&
            entry.decision.originalLevel <
              candidate.originalLevel,
        ) ?? null;

      decision.reasons.push("MARKDOWN_HIERARCHY");
    }

    if (supportedHeuristic) {
      decision.reasons.push(
        "CONSECUTIVE_NUMBERING_SUPPORT",
      );
    }

    if (order === "forward") {
      decision.warnings.push("NUMBERING_GAP");
    }

    if (
      peer &&
      explicit &&
      Number.isInteger(
        peer.decision.originalLevel,
      ) &&
      peer.decision.originalLevel !==
        candidate.originalLevel
    ) {
      decision.warnings.push(
        "MARKDOWN_LEVEL_CONFLICT",
      );
    }

    decision.status = "inferred";

    decision.parentCandidateId =
      parent?.decision.id ?? null;

    decision.depth = parent
      ? parent.decision.depth + 1
      : 1;

    stack.length = parent
      ? stack.indexOf(parent) + 1
      : 0;

    stack.push({ decision, parts });
  }

  return {
    version: "heading-structure-v1",
    identity: structuredClone(identity),
    decisions,
    reviewCandidateIds: decisions
      .filter(
        (decision) =>
          decision.status === "unresolved",
      )
      .map((decision) => decision.id),
  };
}
~~~~

## src/services/structured-units.service.js

~~~~js
export function buildStructuralUnits(extraction, sections, blockPlan, relations) {
  const pages = new Map(extraction.pages.map((page) => [page.id, page]));
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const units = [];
  let serial = 0;
  const partsBySource = new Map();
  for (const section of sections) {
    for (const part of section.parts) {
      const entries = partsBySource.get(part.source.id) ?? [];
      entries.push({ section, part });
      partsBySource.set(part.source.id, entries);
    }
  }

  function add(block, values) {
    units.push({
      id: "unit-" + ++serial, blockId: block.id, kind: block.type,
      warnings: [...block.warnings], locations: block.locations,
      contextLocations: [], ...values,
    });
  }

  function ordinary(block, extra = {}) {
    // Source slices, rather than combined parser text, retain real page boundaries.
    for (const location of block.locations) {
      const page = pages.get(location.sourceId);
      for (const { section, part } of partsBySource.get(page.id) ?? []) {
        if (part.source.id !== page.id) continue;
        const startOffset = Math.max(location.startOffset, part.sourceSpan.startOffset);
        const endOffset = Math.min(location.endOffset, part.sourceSpan.endOffset);
        if (startOffset >= endOffset) continue;
        const text = page.text.slice(startOffset, endOffset);
        if (!text.trim()) continue;
        const unknown = block.warnings.includes("POSSIBLE_TABLE_FRAGMENT");
        add(block, {
          text, sectionId: unknown ? null : section.id,
          readingSectionId: section.id,
          groupId: unknown ? block.id : "text",
          labels: unknown ? ["Unresolved table fragment; column meanings unavailable."] : [],
          locations: [{ ...location, startOffset, endOffset }],
          ...extra,
          labels: [...(unknown ? ["Unresolved table fragment; column meanings unavailable."] : []),
            ...(extra.labels ?? [])],
        });
      }
    }
  }

  function tableUnits(block, extra = {}) {
    const member = relations.members.get(block.id);
    if (!member) return false;
    const { table, rows } = member;
    const contextLocations = table.header.locations.map(
      (location) => ({ ...location, role: "table_header" }));
    for (const note of table.notes) {
      contextLocations.push(...note.locations.map((location) => ({ ...location, role: "table_note" })));
    }
    const labels = table.header.cells.map((cell, index) => {
      const definition = table.definitions[index];
      if (!definition || definition.conflict) return cell.text || "Unlabelled column " + (index + 1);
      const span = definition.sourceSpan;
      const page = pages.get(span.sourceId);
      contextLocations.push({
        ...span, sequenceIndex: page.sequenceIndex,
        sourcePageNumber: page.sourcePageNumber,
        parserPageNumber: page.parserPageNumber,
        sourceKind: page.sourceKind, role: "column_definition",
      });
      return cell.text + " — " + definition.text;
    });
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const fields = row.cells.map((cell, column) => ({
        label: labels[column] || "Unlabelled column " + (column + 1),
        value: cell.text,
      }));
      add(block, {
        kind: "table_row", tableId: table.id, rowId: block.id + "/row-" + (index + 1),
        sectionId: table.sectionId,
        readingSectionId: block.sectionContext.readingOrderSectionIds[0] ?? null,
        groupId: table.id, labels: ["Table: " + table.id, ...table.notes.map((note) => note.text),
          ...(table.warnings.some((warning) => ["TABLE_ROW_WIDTH_MISMATCH", "EMPTY_COLUMN_LABEL"].includes(warning))
            ? ["Table structure requires review."] : [])],
        text: fields.map((field) => field.label + ": " + field.value).join("\n"),
        fields, rowAnchor: fields[0] ? fields[0].label + ": " + fields[0].value : "Row " + (index + 1),
        locations: row.locations, contextLocations,
        warnings: [...block.warnings, ...table.warnings,
          ...(member.continuation ? ["TABLE_CONTINUATION_INFERRED"] : [])],
        referenceSectionIds: table.references.map((ref) => ref.sourceSectionId),
        ...extra,
      });
    }
    // Header-only tables are still searchable.
    if (!rows.length) ordinary(block, { labels: ["Table header; no extracted rows."], ...extra });
    return true;
  }

  function visit(block, listContext = null) {
    if (block.type === "whitespace") return;
    if (relations.members.has(block.id) && tableUnits(block, listContext ? {
      groupId: listContext.groupId,
      labels: [...listContext.labels, "Table: " + relations.members.get(block.id).table.id,
        ...relations.members.get(block.id).table.notes.map((note) => note.text)],
      listItemId: listContext.itemId,
    } : {})) return;
    if (block.type === "list") {
      for (const item of block.list.items) {
        const labels = [
          ...(listContext?.labels ?? ["List: " + block.id]),
          "Item: " + (item.item.marker ?? item.id),
        ];
        const next = { labels, groupId: listContext?.groupId ?? block.id, itemId: item.id };
        if (item.item.blocks.some((child) => ["list", "table", "blockquote"].includes(child.type))) {
          for (const child of item.item.blocks) visit(child, next);
        } else {
          ordinary(item, { kind: "list_item", groupId: next.groupId,
            labels, listItemId: item.id });
        }
      }
    } else if (block.type === "blockquote") {
      for (const child of block.blocks) visit(child, listContext);
    } else {
      const codeLabels = block.type === "code"
        ? ["Code" + (block.code.language ? " (" + block.code.language + ")" : "") + ":"]
        : [];
      ordinary(block, listContext ? {
        labels: [...listContext.labels, ...codeLabels], groupId: listContext.groupId,
        listItemId: listContext.itemId, kind: block.type === "code" ? "code" : "list_item",
      } : codeLabels.length ? { labels: codeLabels } : {});
    }
  }

  for (const block of blockPlan.blocks) visit(block);
  // Consume explanatory links during ingestion, even when no simple column-key
  // definition could be parsed. Keep source section IDs and evidence separately.
  for (const table of relations.tables) {
    for (const sourceSectionId of new Set(table.references.map((ref) => ref.sourceSectionId))) {
      const section = sectionMap.get(sourceSectionId);
      for (const part of section.parts) {
        const page = pages.get(part.source.id);
        if (!part.text.trim()) continue;
        units.push({
          id: "unit-" + ++serial, blockId: null, kind: "table_explanation",
          tableId: table.id, sectionId: table.sectionId,
          readingSectionId: sourceSectionId, groupId: table.id,
          labels: ["Explanation for table: " + table.id],
          text: part.text, warnings: ["REFERENCE_CONTEXT_ATTACHED"],
          locations: [{ ...part.sourceSpan, sequenceIndex: page.sequenceIndex,
            sourcePageNumber: page.sourcePageNumber, parserPageNumber: page.parserPageNumber,
            sourceKind: page.sourceKind }],
          contextLocations: [], referenceSectionIds: [sourceSectionId],
        });
      }
    }
  }
  return units.sort((a, b) =>
    a.locations[0].sequenceIndex - b.locations[0].sequenceIndex ||
    a.locations[0].startOffset - b.locations[0].startOffset);
}

~~~~

## src/services/heading-candidates.service.js

~~~~js
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

~~~~
