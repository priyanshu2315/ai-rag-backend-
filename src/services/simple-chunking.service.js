import { randomUUID } from "node:crypto";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const markdownParser = unified().use(remarkParse).use(remarkGfm);
const VERSION = "ai-corrected-markdown-v1";
const unique = (values) => [...new Set(values)];

function inlineText(node) {
  if (["text", "inlineCode", "html"].includes(node.type)) return node.value;
  if (node.type === "break") return " ";
  if (["image", "imageReference"].includes(node.type)) return node.alt ?? "";
  return (node.children ?? []).map(inlineText).join("");
}

// Gemini fixes the Markdown first. This function only reads its headings and blocks.
// A main section contains its subsections, lists, and page continuations.
export function splitMarkdownSections(extraction) {
  const sections = [];
  let current;
  let headingStack = [];
  let blockIndex = 0;

  function startSection(path) {
    current = {
      id: "section-" + (sections.length + 1),
      headingPath: path,
      blocks: [],
    };
    sections.push(current);
  }

  for (const page of extraction.pages) {
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
      const text = page.text.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      if (!text.trim()) continue;

      if (node.type === "heading") {
        const title = inlineText(node).trim();
        // The correction prompt reserves level 1 for the document title.
        const isDocumentTitle =
          node.depth === 1 && title === extraction.documentTitle;
        if (!isDocumentTitle) {
          headingStack = headingStack.filter(
            (heading) => heading.level < node.depth,
          );
          headingStack.push({ level: node.depth, title });
          if (!current || node.depth <= 2)
            startSection(headingStack.map((heading) => heading.title));
        }
      }

      if (!current) startSection([]);
      current.blocks.push({
        id: "block-" + ++blockIndex,
        type: node.type,
        text,
        node,
        page,
        headingPath: headingStack.map((heading) => heading.title),
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
  const labels = header.children.map(
    (cell, index) => inlineText(cell).trim() || "Column " + (index + 1),
  );
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
  onEvent = () => {},
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
  const searchText = (pieces) =>
    "Document: " +
    title +
    "\n\n" +
    pieces
      .map((piece) => {
        const path = piece.block.headingPath;
        return (
          (path.length ? "Section: " + path.join(" > ") + "\n" : "") +
          piece.text
        );
      })
      .join("\n\n");
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
    return {
      page_number: first.sourcePageNumber,
      source_pages: unique(
        blocks
          .map((block) => block.page.sourcePageNumber)
          .filter((page) => page != null),
      ),
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
      row_ids: unique(pieces.map((piece) => piece.rowId).filter(Boolean)),
      contains_unit_fragments: pieces.some((piece) => piece.fragment),
      structure_warnings: [],
      references: [],
      relationships: [],
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
      if (
        parentPieces.length &&
        (await count(searchText([...parentPieces, piece]))) > parentTokenLimit
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
    if (before.metadata.section_id === current.metadata.section_id) {
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
    totalSections: sections.length,
    totalParents: parents.length,
    totalChildren: parents.reduce(
      (sum, parent) => sum + parent.children.length,
      0,
    ),
  });
  return parents;
}
