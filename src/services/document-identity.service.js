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
