import { llm, summaryLlm, AI_PROVIDER, MODELS } from "../config/ai.js";

const res = await llm.models.list();
const ids = res.data.map((model) => model.id).sort();

const inUse = new Set(Object.values(MODELS));

console.log(`\n${AI_PROVIDER} — ${ids.length} models\n`);

for (const id of ids) {
  console.log(inUse.has(id) ? `  * ${id}` : `    ${id}`);
}

console.log(`\n* = configured in MODELS\n`);

try {
  const geminiModels = await summaryLlm.models.list();
  const geminiIds = [];

  for await (const model of geminiModels) {
    geminiIds.push(model.id);
  }

  console.log(`\nGemini - ${geminiIds.length} models\n`);

  for (const id of geminiIds.sort()) {
    const isSummaryModel =
      id.replace(/^models\//, "") === MODELS.summary;

    console.log(isSummaryModel ? `  * ${id}` : `    ${id}`);
  }

  console.log("\n* = configured summary model\n");
} catch (error) {
  console.error("Could not list Gemini models:", error.message);
  process.exitCode = 1;
}
