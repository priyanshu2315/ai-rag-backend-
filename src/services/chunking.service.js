import { randomUUID } from "node:crypto";
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
