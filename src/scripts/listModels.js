import { llm, AI_PROVIDER, MODELS } from "../config/ai.js";

const res = await llm.models.list();
const ids = res.data.map((model) => model.id).sort();

const inUse = new Set(Object.values(MODELS));

console.log(`\n${AI_PROVIDER} — ${ids.length} models\n`);

for (const id of ids) {
  console.log(inUse.has(id) ? `  * ${id}` : `    ${id}`);
}

console.log(`\n* = configured in MODELS\n`);
