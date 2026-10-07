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