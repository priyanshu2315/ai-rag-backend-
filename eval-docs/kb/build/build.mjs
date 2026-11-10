// Builds HTML sources and PDFs for the synthetic knowledge base.
//   node build.mjs <kbDir> [filePrefix...]
import { writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { render } from "./lib.mjs";

const kbDir = process.argv[2];
const only = process.argv.slice(3);
const require = createRequire("c:/Users/priya/Desktop/Ai Rag/package.json");
const { PDFParse } = require("pdf-parse");
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const docs = [];
for (const file of ["docs-hr.mjs", "docs-fin.mjs", "docs-prc.mjs", "docs-ops.mjs", "docs-it.mjs", "docs-brd.mjs"]) {
  try { docs.push(...(await import("./" + file)).default); } catch (e) { if (e.code !== "ERR_MODULE_NOT_FOUND") throw e; }
}
let total = 0;
for (const doc of docs.filter((d) => !only.length || only.some((o) => d.file.startsWith(o)))) {
  const html = `${kbDir}/source/${doc.file}.html`;
  const pdf = `${kbDir}/pdf/${doc.file}.pdf`;
  await writeFile(html, render(doc));
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`,
    "file:///" + html.replace(/ /g, "%20")], { stdio: "ignore" });
  const parser = new PDFParse({ data: await readFile(pdf) });
  const text = await parser.getText();
  await parser.destroy();
  total += text.pages.length;
  const ends = text.pages.map((pg, i) => `p${i + 1}: ${pg.text.trim().split("\n").at(-1).slice(0, 50)}`).join(" | ");
  console.log(`${doc.file}  pages=${text.pages.length}  ${ends}`);
}
console.log(`documents ${docs.length}, pages built ${total}`);
