// Small HTML helpers for the synthetic knowledge-base documents.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const h2 = (t) => `<h2>${esc(t)}</h2>`;
export const h3 = (t) => `<h3>${esc(t)}</h3>`;
export const p = (...lines) => lines.map((t) => `<p>${esc(t)}</p>`).join("\n");
export const ul = (items) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
export const ol = (items) => `<ol>${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`;
export const pb = () => `<div class="page-break"></div>`;
export const caption = (t) => `<p class="caption">${esc(t)}</p>`;
export const table = (headers, rows, cap) =>
  (cap ? caption(cap) + "\n" : "") +
  `<table>\n<thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>\n<tbody>\n` +
  rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("\n") +
  `\n</tbody>\n</table>`;

export function render({ title, control, body }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="kb.css"></head>
<body>
<p class="company">CALDERWICK PUMP SYSTEMS LTD</p>
<h1>${esc(title)}</h1>
<table class="control">
${control.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("\n")}
</table>

${body.join("\n\n")}
</body></html>
`;
}
