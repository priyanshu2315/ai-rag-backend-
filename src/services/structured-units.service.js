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
