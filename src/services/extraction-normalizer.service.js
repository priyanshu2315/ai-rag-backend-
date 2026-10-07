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