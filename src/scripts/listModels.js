import { getAI } from "../config/ai.js";

const providers = new Map();
for (const task of ["agent", "chat", "fast", "summary"]) {
  const { client, model, providerName } = getAI(task);
  if (!providers.has(providerName)) {
    providers.set(providerName, { client, models: new Set() });
  }
  providers.get(providerName).models.add(model);
}

for (const [providerName, { client, models }] of providers) {
  const res = await client.models.list();
  const ids = res.data.map((model) => model.id).sort();
  console.log(`\n${providerName} — ${ids.length} models\n`);
  for (const id of ids) {
    console.log(models.has(id) ? `  * ${id}` : `    ${id}`);
  }
}

console.log(`\n* = configured for an AI task\n`);
