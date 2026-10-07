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
  const a = /^([A-Za-z_-]+)(\d+)$/.exec(previous?.cells[0]?.text ?? "");
  const b = /^([A-Za-z_-]+)(\d+)$/.exec(next?.cells[0]?.text ?? "");
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
      table = {
        id: "table-" + (tables.length + 1),
        header: block.table.header,
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
