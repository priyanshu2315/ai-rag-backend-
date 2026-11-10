// Repairs Markdown tables the extraction model wrote in a shape Markdown cannot read.
// Tables printed with two heading rows (group headings such as "Electrical" above column
// headings such as "Capacity (kWh)") come back as several heading rows, a delimiter row
// in the wrong place or with the wrong number of cells, or an empty first heading row.
// Markdown then keeps the real headings as data rows ("Column 4: 500") or, when the
// delimiter row does not match the heading row, does not see a table at all.
// Well-formed tables are returned unchanged.

const DELIMITER_CELL = /^:?-{1,}:?$/;

// A line of a pipe table: two or more cell separators, or a leading/trailing pipe.
const isPipeLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("|") || trimmed.endsWith("|")) return true;
  return (trimmed.replace(/\\\|/g, "").match(/\|/g) ?? []).length >= 2;
};

export function tableCells(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

// A delimiter row is sometimes written with a stray empty cell ("| --- | --- | --- | |"); it is
// still the delimiter when every other cell is dashes and the dashes outnumber the empty cells.
const isDelimiter = (cells) => {
  const dashes = cells.filter((cell) => DELIMITER_CELL.test(cell)).length;
  return dashes > 0 && cells.every((cell) => !cell || DELIMITER_CELL.test(cell)) && dashes > cells.length - dashes;
};
const hasDigit = (cells) => cells.some((cell) => /\d/.test(cell));
const nonEmpty = (cells) => cells.filter(Boolean);

function wellFormed(rows) {
  if (rows.length < 2 || isDelimiter(rows[0]) || !isDelimiter(rows[1])) return false;
  const width = rows[0].length;
  if (rows[1].length !== width || !nonEmpty(rows[0]).length) return false;
  return rows.slice(2).every((cells) => !isDelimiter(cells) && cells.length <= width);
}

// One label per column. The row with the most named cells gives the column headings; a
// coarser row (group headings) supplies the first and last label when they span both
// heading rows ("Model" and "Key features" above "Segment … Plant").
function columnLabels(headerRows, width) {
  if (!headerRows.length) return Array(width).fill("");
  // Heading rows written cell for cell: each column takes its lowest (most specific) name.
  if (headerRows.length > 1 && headerRows.every((cells) => cells.length === width)) {
    return Array.from({ length: width }, (_, column) =>
      headerRows.map((cells) => cells[column]).filter(Boolean).at(-1) ?? "");
  }
  const ranked = [...headerRows].sort((a, b) => nonEmpty(b).length - nonEmpty(a).length);
  const detail = ranked[0];
  const coarse = nonEmpty(ranked[1] ?? []);
  if (detail.length === width) {
    return detail.map((label, index) => {
      if (label) return label;
      if (index === 0) return coarse[0] ?? "";
      if (index === width - 1 && coarse.length > 1) return coarse.at(-1);
      return "";
    });
  }
  const names = nonEmpty(detail);
  if (names.length >= width) return names.slice(0, width);
  if (names.length === width - 1) return [coarse[0] ?? "", ...names];
  if (names.length === width - 2 && coarse.length > 1) return [coarse[0], ...names, coarse.at(-1)];
  return [...names, ...Array(width - names.length).fill("")];
}

// A table without a delimiter row whose first row is a lone title ("| TEST RESULTS | | | |")
// and whose second row names every column ("| # | Check | Specification | Result |"): the
// title goes above the table as bold text and the names become the heading row.
function titledTable(rows) {
  if (rows.length < 3 || nonEmpty(rows[0]).length !== 1 || !rows[0][0]) return null;
  const names = rows[1];
  if (names.length < 2 || nonEmpty(names).length !== names.length || hasDigit(names)) return null;
  if (!rows.slice(2).some(hasDigit)) return null;
  const width = names.length;
  const pad = (cells) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")].slice(0, width);
  return {
    lines: [
      "**" + rows[0][0] + "**",
      "",
      "| " + names.join(" | ") + " |",
      "|" + names.map(() => "---").join("|") + "|",
      ...rows.slice(2).map((cells) => "| " + pad(cells).join(" | ") + " |"),
    ],
    columns: width,
    headerRows: 1,
  };
}

function repairRun(lines) {
  const rows = lines.map(tableCells);
  const delimiters = rows.map((cells, index) => (isDelimiter(cells) ? index : -1)).filter((index) => index !== -1);
  // Without a delimiter row Markdown does not read the lines as a table, so they are left
  // as written, unless the first two rows are a title and the column names.
  if (!delimiters.length) return titledTable(rows);
  if (wellFormed(rows)) return null;

  const lastDelimiter = delimiters.at(-1);
  const headerRows = rows.slice(0, lastDelimiter).filter((cells) => !isDelimiter(cells));
  let body = rows.slice(lastDelimiter + 1).filter((cells) => !isDelimiter(cells));
  if (!body.length) return null;
  const width = Math.max(...body.map((cells) => cells.length));
  // A row of names with no values right after the delimiter is the second heading row,
  // when the heading rows above it do not already name every column.
  while (body.length > 1 && !hasDigit(body[0]) &&
    Math.max(0, ...headerRows.map((cells) => nonEmpty(cells).length)) < width &&
    nonEmpty(body[0]).length < width) {
    headerRows.push(body[0]);
    body = body.slice(1);
  }
  const labels = columnLabels(headerRows, width);
  const pad = (cells) => [...cells, ...Array(Math.max(0, width - cells.length)).fill("")].slice(0, width);
  const out = [
    "| " + labels.join(" | ") + " |",
    "|" + labels.map(() => "---").join("|") + "|",
    ...body.map((cells) => "| " + pad(cells).join(" | ") + " |"),
  ];
  return { lines: out, columns: width, headerRows: headerRows.length };
}

// A cell printed over several lines is sometimes copied with its line breaks, so one table
// row becomes "| Plant | Nameplate", "(GWh/yr) | FY2025", "production", "(GWh) | Operating",
// "subsidiary |". A line that opens with "|" but does not close with one is joined with the
// following lines up to the first one that closes with "|", when none of them opens a new row.
const MAX_WRAPPED_LINES = 8;
function joinWrappedCells(lines) {
  const out = [];
  let joined = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    let close = -1;
    if (trimmed.startsWith("|") && !trimmed.endsWith("|") && trimmed.length > 1) {
      for (let end = index + 1; end < lines.length && end - index <= MAX_WRAPPED_LINES; end++) {
        const next = lines[end].trim();
        if (!next || next.startsWith("|")) break;
        if (next.endsWith("|")) {
          close = end;
          break;
        }
      }
    }
    if (close === -1) {
      out.push(line);
      continue;
    }
    out.push(lines.slice(index, close + 1).map((part) => part.trim()).join(" "));
    joined++;
    index = close;
  }
  return { lines: out, joined };
}

// Two tables written as one run of rows: the first table's rows, then (optionally) the second
// table's caption as a one-cell row, the second table's heading row and its |---| row. Without
// a split the repair below would take every row of the first table as a heading row. A run
// that starts with a heading and |---| row and has a later |---| row after data rows is cut
// before the second heading row; the caption row becomes a bold line between the two.
const CAPTION_CELL = /^[*_]*(?:table|tab\.|figure|fig\.|exhibit|chart)\s*[A-Z]?[.-]?\d/i;
function splitGluedTables(run) {
  const rows = run.map(tableCells);
  if (rows.length < 5 || !isDelimiter(rows[1])) return [{ lines: run, table: true }];
  const next = rows.findIndex((cells, index) => index >= 4 && isDelimiter(cells) && !isDelimiter(rows[index - 1]));
  if (next === -1) return [{ lines: run, table: true }];
  // The same heading row written again further down is one table: the repeat is dropped.
  if (rows[next - 1].join("|") === rows[0].join("|")) {
    return splitGluedTables([...run.slice(0, next - 1), ...run.slice(next + 1)]);
  }
  let end = next - 1;
  const parts = [];
  const caption = rows[end - 1];
  const captionText = nonEmpty(caption).length === 1 && CAPTION_CELL.test(nonEmpty(caption)[0]) ? nonEmpty(caption)[0] : null;
  if (captionText) end--;
  if (end < 3) return [{ lines: run, table: true }];
  parts.push({ lines: run.slice(0, end), table: true });
  if (captionText) parts.push({ lines: ["**" + captionText.replace(/^\*+|\*+$/g, "") + "**"], table: false });
  return [...parts, ...splitGluedTables(run.slice(next - 1))];
}

/**
 * A line written directly under a table's last row, without a blank line, is read by
 * Markdown as one more row of that table. The next table's caption ("Table 26.2 – …"),
 * its heading row and its |---| row then all become rows of the table above, and the
 * second table is filed under the first one's caption. A blank line is put after every
 * table that is followed directly by other text.
 * @param {string} text  one page of extracted Markdown
 * @returns {{ text: string, repaired: { line: number, columns: number, headerRows: number }[], joinedRows: number, separated: number }}
 */
export function repairMarkdownTables(text) {
  const wrapped = joinWrappedCells(String(text ?? "").split("\n"));
  const lines = wrapped.lines;
  const out = [];
  const repaired = [];
  let separated = 0;
  let index = 0;
  while (index < lines.length) {
    if (!isPipeLine(lines[index])) {
      out.push(lines[index++]);
      continue;
    }
    const start = index;
    while (index < lines.length && isPipeLine(lines[index])) index++;
    const run = lines.slice(start, index);
    const parts = splitGluedTables(run);
    parts.forEach((part, partIndex) => {
      if (partIndex > 0) {
        out.push("");
        separated++;
      }
      const fixed = part.table && part.lines.length >= 2 ? repairRun(part.lines) : null;
      if (fixed) {
        repaired.push({ line: start + 1, columns: fixed.columns, headerRows: fixed.headerRows });
        out.push(...fixed.lines);
      } else {
        out.push(...part.lines);
      }
    });
    if (run.length >= 2 && lines[index]?.trim()) {
      out.push("");
      separated++;
    }
  }
  return { text: out.join("\n"), repaired, joinedRows: wrapped.joined, separated };
}
