import { randomUUID } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { appendixAtPage } from "./document-outline.service.js";

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const VERSION = "ai-corrected-markdown-v3";
const unique = (values) => [...new Set(values)];

function inlineText(node) {
  if (["text", "inlineCode", "html"].includes(node.type)) return node.value;
  if (node.type === "break") return " ";
  if (["image", "imageReference"].includes(node.type)) return node.alt ?? "";
  return (node.children ?? []).map(inlineText).join("");
}

function numberedRowKey(value) {
  const match = value.trim().match(/^([\p{L}]+)[\s-]*(\d{1,6})(?:[^\p{L}\p{N}]|$)/u);
  return match ? { prefix: match[1].toLowerCase(), number: Number(match[2]) } : null;
}

function continuesNumberedRows(previous, next) {
  return previous && next && previous.prefix === next.prefix &&
    next.number === previous.number + 1;
}

function compatibleTableLabels(previous, next) {
  if (previous.length !== next.length) return false;
  return previous.every((label, index) => {
    const before = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const after = next[index].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!before || !after) return false;
    return before === after || before.startsWith(after + " ") ||
      after.startsWith(before + " ") ||
      (index >= 2 && before.startsWith("column " + after + " "));
  });
}

function detectDocumentBoundary(page, documentOutline = []) {
  const pageText = page.text || "";
  const pageNum = page.sourcePageNumber;
  const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);
  const headerBlock = lines.join(" ");
  // 1. Check official Table of Contents outline
  if (Array.isArray(documentOutline) && documentOutline.length > 0) {
    const match = documentOutline.find((entry) => {
      const isAppendixOrAnnex = /(?:appendix|annex|exhibit|schedule|attachment|minutes|restatement)/i.test(
        `${entry.sectionCode || ""} ${entry.title || ""}`
      );
      // For appendices/annexures: page match is sufficient (e.g. Appendix B on page 20)
      if (isAppendixOrAnnex && entry.targetPage != null && entry.targetPage === pageNum) {
        return true;
      }
      // For top-level sections (e.g. Section 7): only if title is in headerBlock and NOT a dotted subsection (7.1, 7.2)
      const isSubsection = /\d+\.\d+/.test(entry.sectionCode || "");
      if (!isSubsection && entry.title && headerBlock.toLowerCase().includes(entry.title.toLowerCase())) {
        return true;
      }
      return false;
    });
    if (match) {
      const code = match.sectionCode ? match.sectionCode.trim() : "";
      const title = match.title ? match.title.trim() : "";
      // Avoid stuttering like "7 - 7 Governance and Approval Matrix"
      if (code && title && !title.toLowerCase().startsWith(code.toLowerCase())) {
        return `${code} - ${title}`;
      }
      return title || code;
    }
  }
  // 2. Check if extractor already gave a boundaryTitle
  if (page.boundaryTitle && page.isDocumentBoundary) {
    return page.boundaryTitle.trim();
  }

  // 3. Regex Fallback: Explicit Appendix / Annex header on the page
  const appendixMatch = headerBlock.match(/^(?:[A-Z]\s+)?(Appendix\s+[A-Z0-9]+[\s:\-\–—]+[^\n\r]+)/i);
  if (appendixMatch) {
    return appendixMatch[1].trim();
  }

  // 4. Regex Fallback: Formal Board Minutes
  if (/MINUTES OF (?:A )?MEETING/i.test(headerBlock)) {
    return "Board minutes";
  }

  // 5. Regex Fallback: CFO Letterhead / Restatement
  if (/(?:Office of the Chief Financial Officer|Subject:\s*Restatement)/i.test(headerBlock)) {
    return "CFO restatement letter";
  }

  // 6. Regex Fallback: Test Record / Quality Form
  if (/FACTORY ACCEPTANCE TEST RECORD|FORM\s+FAT/i.test(headerBlock)) {
    return "Factory acceptance test record";
  }

  return null;
}


// Generic cross-reference extractor: detects standard citations across all documents
function extractCrossReferences(text) {
  if (!text) return [];
  const refs = new Set();

  // 1. Section & Clause references: §3.5, Section 7.1, Clause 4.2
  for (const match of text.matchAll(/(?:§|Section|Clause)\s*(\d+(?:\.\d+)*)/gi)) {
    refs.add(`§${match[1]}`);
  }
  // 2. Appendix references: Appendix B, Appendix C
  for (const match of text.matchAll(/Appendix\s+([A-Z0-9]+)/gi)) {
    refs.add(`Appendix ${match[1].toUpperCase()}`);
  }
  // 3. Table and Figure references: Table 7.1, Figure 4.3
  for (const match of text.matchAll(/(?:Table|Figure)\s+(\d+(?:\.\d+)*)/gi)) {
    refs.add(match[0]);
  }
  // 4. Resolutions: Resolution 2025-14, Resolution YYYY-NN
  for (const match of text.matchAll(/Resolution\s+([A-Z0-9\-]+)/gi)) {
    refs.add(`Resolution ${match[1]}`);
  }
  // 5. Standard codes: R-01 to R-99 (Risks), TN-1 to TN-99 (Tech Notes)
  for (const match of text.matchAll(/\b([A-Z]{1,3}-\d{1,3})\b/g)) {
    refs.add(match[1]);
  }

  return [...refs];
}

// Detects if a chunk belongs to a Table of Contents
function isTableOfContentsChunk(headingPath, text) {
  const pathStr = (headingPath || []).join(" ").toLowerCase();
  if (pathStr.includes("table of contents") || pathStr.includes("contents")) {
    return true;
  }
  // Matches repeated dot-leader lines ending in page numbers (. . . 4, .... 12)
  const dotLines = (text || "").split("\n").filter((l) => /\.{3,}|\. \. \./.test(l) && /\d+\s*$/.test(l.trim()));
  return dotLines.length >= 3;
}

function getHeadingLevel(title, rawDepth, hasActiveBoundary = false) {
  const clean = title.trim();
  // Match decimal numbering: "1.", "1.1", "4.4.1"
  const match = clean.match(/^(?:section|clause|article)?\s*(\d+(?:\.\d+)*)(?:[.\s\-]|$)/i);
  if (match) {
    const parts = match[1].split(".").filter(Boolean);
    // When inside an Appendix or Document Boundary, items like "1.", "2.", "3."
    // are subsections of that appendix (Level 3+) and must never pop the boundary container
    const baseLevel = hasActiveBoundary ? 3 : 2;
    return parts.length - 1 + baseLevel;
  }
  // Major standalone document markers are always Level 2 (main sections)
  if (/^(?:Table of Contents|Contents|Document Control|Appendix\s+[A-Z0-9]|Annex|Exhibit)/i.test(clean)) {
    return 2;
  }

  return Math.max(rawDepth || 3, 3);
}



// Gemini fixes the Markdown first. This function reads its headings, tables, and boundaries.
export function splitMarkdownSections(extraction) {
  const sections = [];
  const tables = [];
  let current;
  let headingStack = [];
  let blockIndex = 0;
  function startSection(path, id = "section-" + (sections.length + 1)) {
    current = {
      id,
      headingPath: path,
      blocks: [],
    };
    sections.push(current);
  }
  const documentOutline = extraction.documentOutline || [];
  const totalPages = extraction.pageCount;

  for (const page of extraction.pages) {
    let beforeFirstHeading = true;
    const appendix = Number.isSafeInteger(totalPages)
      ? appendixAtPage(documentOutline, page.sourcePageNumber, totalPages)
      : null;
    // An established appendix range takes priority over an AI boundary flag.
    const boundaryTitle = appendix
      ? (headingStack[0]?.title === appendix.title ? null : appendix.title)
      : detectDocumentBoundary(page, documentOutline);

    if (boundaryTitle) {
      // Pop all sections and start a fresh main section (level 2)
      headingStack = [{ level: 2, title: boundaryTitle, isBoundary: true }];
      startSection([boundaryTitle]);
      beforeFirstHeading = false;
    }
    const nodes =
      page.textFormat === "plain"
        ? [
          {
            type: "paragraph",
            position: {
              start: { offset: 0 },
              end: { offset: page.text.length },
            },
          },
        ]
        : markdownParser.parse(page.text).children;
    for (const node of nodes) {
      let text = page.text.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      if (node.type === "heading") {
        text = text.replace(/[\s\-_]*\((?:continued|cont\.?|continuation)\)\s*$/i, "").trim();
      }
      if (!text.trim()) continue;
      let tableHeader;
      let table;
      let continuation;
      if (node.type === "table") {
        const [header, ...rows] = node.children;
        const labels = header.children.map((cell) => inlineText(cell).trim());
        tableHeader = labels.map((label) => label.toLowerCase()).join("|");
        const firstRowKey = numberedRowKey(inlineText(rows[0]?.children[0] ?? { type: "text", value: "" }));
        const lastRowKey = numberedRowKey(inlineText(rows.at(-1)?.children[0] ?? { type: "text", value: "" }));
        const isSameSection = current?.id && tables.some((t) => t.sectionId === current.id);
        if ((beforeFirstHeading || isSameSection) && rows.length > 0) {
          const candidates = tables.filter((candidate) =>
            candidate.labels.length === labels.length &&
            (!appendix || candidate.headingStack[0]?.title === appendix.title) &&
            candidate.pageIndex < page.sequenceIndex &&
            candidate.pageIndex >= page.sequenceIndex - 2,
          );
          const numbered = candidates.filter((candidate) =>
            labels.length >= 3 &&
            continuesNumberedRows(candidate.lastRowKey, firstRowKey) &&
            compatibleTableLabels(candidate.labels, labels),
          );
          const exact = candidates.filter((candidate) => candidate.headers.has(tableHeader));
          table = numbered.length === 1 ? numbered[0] :
            numbered.length === 0 && exact.length === 1 ? exact[0] : null;
          if (table) {
            table.continued = true;
            continuation = {
              type: "table_continuation",
              table_id: table.id,
              from_page: table.pageNumber,
              to_page: page.sourcePageNumber,
              match: numbered.includes(table) ? "row_sequence" : "column_headers",
            };
            if (current?.id !== table.sectionId) {
              headingStack = table.headingStack.map((heading) => ({ ...heading }));
              startSection(table.headingPath, table.sectionId);
            }
          }
        }
        if (!table) {
          table = {
            id: "table-" + (tables.length + 1),
            sectionId: current?.id,
            headingPath: current?.headingPath,
            headingStack: headingStack.map((heading) => ({ ...heading })),
            labels,
            headers: new Set(),
          };
          tables.push(table);
        }
        table.headers.add(tableHeader);
        table.pageIndex = page.sequenceIndex;
        table.pageNumber = page.sourcePageNumber;
        table.lastRowKey = lastRowKey;
      }
      if (node.type === "heading") {
        const rawTitle = inlineText(node).trim();
        const title = rawTitle.replace(/[\s\-_]*\((?:continued|cont\.?|continuation)\)\s*$/i, "").trim();
        const isDocumentTitle =
          node.depth === 1 && title === extraction.documentTitle;
        if (!isDocumentTitle) {
          const hasActiveBoundary = headingStack.some((h) => h.isBoundary);

          // A repeated appendix heading must not pop its resolved container.
          const effectiveLevel = appendix
            ? Math.max(3, getHeadingLevel(title, node.depth, hasActiveBoundary))
            : getHeadingLevel(title, node.depth, hasActiveBoundary);

          // Pop any headings of equal or deeper level
          headingStack = headingStack.filter((h) => h.level < effectiveLevel);
          headingStack.push({ level: effectiveLevel, title });
          const nextPath = headingStack.map((h) => h.title);
          const repeatedHeading = beforeFirstHeading &&
            current && JSON.stringify(nextPath) === JSON.stringify(current.headingPath);
          if (!repeatedHeading) {
            const resumed = sections.find(
              (section) => JSON.stringify(section.headingPath) === JSON.stringify(nextPath),
            );
            startSection(nextPath, resumed?.id);
            beforeFirstHeading = false;
          }
        }
      }
      if (!current) startSection([]);
      if (table && !table.sectionId) {
        table.sectionId = current.id;
        table.headingPath = current.headingPath;
      }
      current.blocks.push({
        id: "block-" + ++blockIndex,
        type: node.type,
        text,
        node,
        page,
        headingPath: headingStack.map((heading) => heading.title),
        tableId: table?.id ?? null,
        table,
        tableLabels: continuation?.match === "row_sequence" ? table.labels : null,
        continuation,
        location: {
          sourceId: page.id,
          sourceKind: page.sourceKind,
          sequenceIndex: page.sequenceIndex,
          sourcePageNumber: page.sourcePageNumber,
          parserPageNumber: page.parserPageNumber,
          startOffset: node.position.start.offset,
          endOffset: node.position.end.offset,
          scope: "corrected_markdown_block",
          role: "passage",
        },
      });
    }
  }
  return sections;
}
// Repeat table column labels and row identity instead of embedding isolated values.
function blockPassages(block) {
  if (block.type !== "table") return [{ text: block.text, block }];
  const [header, ...rows] = block.node.children;
  if (!rows.length) return [{ text: block.text, block }];
  const labels = (block.tableLabels ?? header.children.map((cell) => inlineText(cell).trim()))
    .map((label, index) => label || "Column " + (index + 1));
  return rows.map((row, index) => {
    const fields = row.children.map((cell, column) => ({
      label: labels[column] ?? "Column " + (column + 1),
      value: inlineText(cell),
    }));
    return {
      block,
      rowId: block.id + "/row-" + (index + 1),
      fields,
      rowIdentity: fields[0].label + ": " + fields[0].value,
      text: fields.map((field) => field.label + ": " + field.value).join("\n"),
    };
  });
}

export async function buildDocumentChunks(
  extraction,
  documentId,
  filename,
  onEvent = () => { },
  { measure, parentTokenLimit = 1024, childTokenLimit = 256 } = {},
) {
  if (!extraction?.pages?.length)
    throw new Error("Document has no extracted pages");
  if (typeof measure !== "function")
    throw new Error("Embedding tokenizer is required");
  if (
    !Number.isSafeInteger(parentTokenLimit) ||
    !Number.isSafeInteger(childTokenLimit) ||
    childTokenLimit < 1 ||
    parentTokenLimit < childTokenLimit
  ) {
    throw new Error("Expected positive token budgets with parent >= child");
  }
  const title = extraction.documentTitle || filename;
  const identity = {
    version: "document-identity-v1",
    filename,
    title,
    status: extraction.documentTitle ? "inferred" : "fallback",
    titleSource: extraction.documentTitle
      ? extraction.correction?.operation === "extraction"
        ? "ai_extraction"
        : "ai_correction"
      : "filename",
  };
  const sections = splitMarkdownSections(extraction);
  const parents = [];
  // Use the embedding model's tokenizer, not a characters-to-tokens estimate.
  const childLimit = Math.min(childTokenLimit, (await measure("")).tokenLimit);
  const count = async (text) => (await measure(text)).tokenCount;
  const searchText = (pieces) => {
    let lastPath = null;
    const parts = ["Document: " + title];
    for (const piece of pieces) {
      const path = piece.block.headingPath;
      const pathStr = path.length ? "Section: " + path.join(" > ") : "";
      if (pathStr && pathStr !== lastPath) {
        parts.push(pathStr);
        lastPath = pathStr;
      }
      parts.push(piece.text);
    }
    return parts.join("\n\n");
  };
  const bodyText = (pieces) => pieces.map((piece) => piece.text).join("\n\n");

  await onEvent({
    type: "chunking_start",
    stage: "preparing",
    chunkerVersion: VERSION,
    sizeUnit: "tokens",
    totalSources: extraction.pages.length,
  });
  await onEvent({ type: "document_identity", stage: "preparing", identity });

  // Split only oversized passages. Every fragment keeps its section and table labels.
  async function splitPassage(passage) {
    const rendered = {
      ...passage,
      text: (passage.context ?? "") + passage.text,
    };
    if ((await count(searchText([rendered]))) <= childLimit) return [rendered];
    if (passage.fields) {
      const pieces = [];
      for (const field of passage.fields) {
        pieces.push(
          ...(await splitPassage({
            ...passage,
            fields: null,
            fragment: true,
            context:
              "Row identity: " +
              passage.rowIdentity +
              "\n" +
              field.label +
              ": ",
            text: field.value,
          })),
        );
      }
      return pieces;
    }
    // Keep an explicit repeated prefix separate from the value being split.
    const chars = Array.from(passage.text);
    if (chars.length <= 1)
      throw new Error(
        "Document or section context exceeds the embedding budget",
      );
    let cut = Math.floor(chars.length / 2);
    for (let index = cut; index > cut / 2; index--) {
      if (index + 1 < chars.length && /\s/u.test(chars[index])) {
        cut = index + 1;
        break;
      }
    }
    const pieces = [];
    for (const value of [
      chars.slice(0, cut).join(""),
      chars.slice(cut).join(""),
    ]) {
      pieces.push(
        ...(await splitPassage({ ...passage, text: value, fragment: true })),
      );
    }
    return pieces;
  }

  function metadata(pieces, section, chunkIndex) {
    const blocks = [
      ...new Map(pieces.map((piece) => [piece.block.id, piece.block])).values(),
    ];
    const first = blocks[0].page;
    // A parent can contain multiple steps; its common ancestor is the main section.
    const samePath = blocks.every(
      (block) =>
        JSON.stringify(block.headingPath) ===
        JSON.stringify(blocks[0].headingPath),
    );
    const primaryPage = first.sourcePageNumber ?? (first.sequenceIndex != null ? first.sequenceIndex + 1 : 1);
    const pages = unique(
      blocks
        .map((block) => block.page.sourcePageNumber ?? (block.page.sequenceIndex != null ? block.page.sequenceIndex + 1 : 1))
        .filter((page) => page != null),
    );

    const fullText = bodyText(pieces);
    const isToc = isTableOfContentsChunk(section.headingPath, fullText);
    const extractedRefs = extractCrossReferences(fullText);

    // Keep AI-detected references, but ONLY if they are actually mentioned in this chunk's text
    const fullTextLower = fullText.toLowerCase();
    const verifiedAiRefs = (first.references || []).filter((ref) => {
      if (!ref || typeof ref !== "string") return false;
      return fullTextLower.includes(ref.trim().toLowerCase());
    });

    const combinedRefs = unique([
      ...extractedRefs,   // Regex detections (§4.3, Table 4.2, TN-6)
      ...verifiedAiRefs,  // AI semantic citations verified inside this specific chunk
    ]);

    return {
      page_number: primaryPage,
      source_pages: pages.length ? pages : [primaryPage],
      source: {
        id: first.id,
        kind: first.sourceKind,
        sequenceIndex: first.sequenceIndex,
        parserPageNumber: first.parserPageNumber,
        sourcePageNumber: first.sourcePageNumber,
        textFormat: first.textFormat,
        warnings: first.warnings,
      },
      source_locations: blocks.map((block) => block.location),
      context_locations: [],
      source_text:
        extraction.correction?.operation === "extraction"
          ? "ai_extracted_markdown"
          : extraction.correction
            ? "ai_corrected_markdown"
            : "extracted_text",
      extraction: {
        schema_version: extraction.schemaVersion,
        provider: extraction.provider,
        job_id: extraction.jobId,
        warnings: extraction.warnings,
      },
      // Avoid copying the full 600-page batch usage list into every saved chunk.
      correction: extraction.correction
        ? {
          version: extraction.correction.version,
          provider: extraction.correction.provider,
          model: extraction.correction.model,
          visualInput: extraction.correction.visualInput,
          operation: extraction.correction.operation ?? "correction",
          batches: unique(
            blocks.map((block) => block.page.correctionBatch).filter(Boolean),
          ),
        }
        : null,
      document_title: title,
      document_identity: identity,
      heading_path: samePath ? blocks[0].headingPath : section.headingPath,
      heading_paths: unique(
        blocks.map((block) => JSON.stringify(block.headingPath)),
      ).map((path) => JSON.parse(path)),
      section_id: section.id,
      section_structure: {
        status:
          extraction.correction?.operation === "extraction"
            ? "ai_extracted"
            : extraction.correction
              ? "ai_corrected"
              : "markdown",
        review_required: false,
      },
      chunk_index: chunkIndex,
      chunker_version: VERSION,
      block_ids: blocks.map((block) => block.id),
      block_types: unique(blocks.map((block) => block.type)),
      table_ids: unique(blocks.map((block) => block.tableId).filter(Boolean)),
      linked_table_ids: unique(blocks
        .filter((block) => block.table?.continued)
        .map((block) => block.tableId)),
      row_ids: unique(pieces.map((piece) => piece.rowId).filter(Boolean)),
      contains_unit_fragments: pieces.some((piece) => piece.fragment),
      structure_warnings: [],
      is_toc: isToc,
      references: combinedRefs,
      cross_references: combinedRefs,
      relationships: blocks.map((block) => block.continuation).filter(Boolean),
    };
  }

  for (const section of sections) {
    await onEvent({
      type: "section",
      stage: "preparing",
      sectionId: section.id,
      headingPath: section.headingPath,
      totalBlocks: section.blocks.length,
    });
    const pieces = [];
    for (const block of section.blocks) {
      await onEvent({
        type: "block",
        stage: "preparing",
        sectionId: section.id,
        blockId: block.id,
        blockType: block.type,
        page: block.page.sourcePageNumber,
        headingPath: block.headingPath,
        text: block.text,
      });
      for (const passage of blockPassages(block))
        pieces.push(...(await splitPassage(passage)));
    }

    let parentPieces = [];
    let childPieces = [];
    let children = [];
    async function finishChild() {
      if (!childPieces.length) return;
      const tokens = await measure(searchText(childPieces));
      children.push({
        pieces: childPieces,
        text: bodyText(childPieces),
        searchText: searchText(childPieces),
        tokens,
      });
      childPieces = [];
    }
    async function finishParent() {
      if (!parentPieces.length) return;
      await finishChild();
      const id = randomUUID();
      const chunkIndex = parents.length;
      parents.push({
        id,
        documentId,
        text: bodyText(parentPieces),
        searchText: searchText(parentPieces),
        prevParentId: null,
        nextParentId: null,
        metadata: {
          ...metadata(parentPieces, section, chunkIndex),
          token_budget: {
            tokenCount: await count(searchText(parentPieces)),
            tokenLimit: parentTokenLimit,
          },
        },
        children: children.map((child, childIndex) => ({
          id: randomUUID(),
          documentId,
          parentId: id,
          text: child.text,
          searchText: child.searchText,
          metadata: {
            ...metadata(child.pieces, section, chunkIndex),
            child_index: childIndex,
            token_budget: {
              ...child.tokens,
              tokenLimit: childLimit,
              withinLimit: true,
            },
          },
        })),
      });
      parentPieces = [];
      children = [];
    }
    for (const piece of pieces) {
      const parentPage = parentPieces[0]?.block.page.sourcePageNumber;
      const piecePage = piece.block.page.sourcePageNumber;
      const newPage = parentPage != null && piecePage != null && parentPage !== piecePage;
      if (
        parentPieces.length &&
        (newPage ||
          (await count(searchText([...parentPieces, piece]))) > parentTokenLimit)
      ) {
        await finishParent();
      }
      if (
        childPieces.length &&
        (await count(searchText([...childPieces, piece]))) > childLimit
      ) {
        await finishChild();
      }
      parentPieces.push(piece);
      childPieces.push(piece);
    }
    await finishParent();
  }
  if (!parents.length) throw new Error("Document contains no usable content");
  for (let index = 1; index < parents.length; index++) {
    const before = parents[index - 1];
    const current = parents[index];
    const sameChapter = before.metadata?.heading_path?.[0] &&
      before.metadata?.heading_path?.[0] === current.metadata?.heading_path?.[0];
    if (before.metadata.section_id === current.metadata.section_id || sameChapter) {
      before.nextParentId = current.id;
      current.prevParentId = before.id;
    }
  }
  for (const parent of parents) {
    await onEvent({
      type: "parent_created",
      stage: "preparing",
      parent: {
        ...parent,
        children: undefined,
        totalChildren: parent.children.length,
      },
    });
    for (const child of parent.children)
      await onEvent({ type: "child_created", stage: "preparing", child });
    await onEvent({
      type: "parent_links",
      stage: "preparing",
      parentId: parent.id,
      sectionId: parent.metadata.section_id,
      prevParentId: parent.prevParentId,
      nextParentId: parent.nextParentId,
    });
  }
  await onEvent({
    type: "chunking_complete",
    stage: "preparing",
    totalSections: unique(sections.map((section) => section.id)).length,
    totalParents: parents.length,
    totalChildren: parents.reduce(
      (sum, parent) => sum + parent.children.length,
      0,
    ),
  });
  return parents;
}
