import fs from "fs";
import path from "path";
import * as aiService from "./../services/ai.service.js";
import { llm, MODELS } from "../config/ai.js";
import { searchSingleDocument } from "../repositories/chat.repository.js";
import { fileURLToPath } from "url";

const TEST_DOC_ID = "00000000-0000-0000-0002-000000000000";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const getRank = (chunks, target) => {
  const targets = Array.isArray(target) ? target : [target];
  let worstRank = 0;
  for (const id of targets) {
    const index = chunks.findIndex((chunk) => chunk.id === id);
    if (index === -1) return 0;
    worstRank = Math.max(worstRank, index + 1);
  }
  return worstRank;
};

const pct = (value, total) =>
  total === 0 ? "n/a" : `${((value / total) * 100).toFixed(1)}%`;

async function runEvals() {
  const datasetPath = path.resolve(__dirname, "../evals/goldenDataSet2.js");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

  let totalMRR = 0;
  let hitsAt3 = 0;
  let hitsAt5 = 0;
  let retrievalCount = 0;
  let totalFaithfulness = 0;
  let totalRelevance = 0;
  const categories = {};

  console.log(
    `Starting Hard Evaluation Harness for ${dataset.length} questions...\n`,
  );

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    console.log(`[Q${i + 1}/${dataset.length}] Evaluating: "${item.question}"`);

    const queryVectorArray = await aiService.getEmbedding(item.question);
    const vectorStr = `[${queryVectorArray.join(",")}]`;

    const searchResults = await searchSingleDocument(
      TEST_DOC_ID,
      vectorStr,
      item.question,
      15,
    );

    const bestChunks =
      searchResults.length > 0
        ? await aiService.rerankChunks(item.question, searchResults, 3)
        : [];

    const hasTarget = item.target_parent_chunk_id !== null;
    let rank = 0;
    if (hasTarget) {
      retrievalCount++;
      rank = getRank(bestChunks, item.target_parent_chunk_id);
      if (rank > 0) {
        totalMRR += 1 / rank;
        if (rank <= 3) hitsAt3++;
        if (rank <= 5) hitsAt5++;
      }
    }

    const contextText = bestChunks.map((c) => c.text).join("\n\n---\n\n");

    const agentResponse = await llm.chat.completions.create({
      model: MODELS.agent,
      messages: [
        {
          role: "system",
          content:
            "Answer the user's question based strictly on the provided context.",
        },
        {
          role: "user",
          content: `Context:\n${contextText}\n\nQuestion: ${item.question}`,
        },
      ],
      temperature: 0,
    });
    const generatedAnswer = agentResponse.choices[0].message.content;

    const judgePrompt = `
      You are an impartial AI judge. Evaluate the Generated Answer based on two criteria:
      1. Faithfulness (0 or 1): Is the Generated Answer strictly derived from the Context? (0 if hallucinated).
      2. Relevance (0 or 1): Does the Generated Answer actually answer the Question and match the Expected Answer?
      If the Expected Answer says the document does not contain the information, Relevance is 1 only if the Generated Answer also says the information is not available, and 0 if it invents an answer.
      If the Expected Answer contains a specific number, Relevance is 0 if the Generated Answer gives a different number.

      Context: ${contextText}
      Question: ${item.question}
      Expected Answer: ${item.expected_answer}
      Generated Answer: ${generatedAnswer}

      Return ONLY a JSON object: {"faithfulness": 1, "relevance": 1}
    `;

    const judgeResponse = await llm.chat.completions.create({
      model: MODELS.agent,
      messages: [{ role: "user", content: judgePrompt }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const scores = JSON.parse(judgeResponse.choices[0].message.content);
    const faithfulness = scores.faithfulness || 0;
    const relevance = scores.relevance || 0;
    totalFaithfulness += faithfulness;
    totalRelevance += relevance;

    const bucket = (categories[item.category] ||= {
      count: 0,
      retrievalCount: 0,
      hits: 0,
      faithfulness: 0,
      relevance: 0,
    });
    bucket.count++;
    bucket.faithfulness += faithfulness;
    bucket.relevance += relevance;
    if (hasTarget) {
      bucket.retrievalCount++;
      if (rank > 0) bucket.hits++;
    }

    const rankLabel = !hasTarget ? "N/A" : rank > 0 ? rank : "MISS";
    console.log(
      `  -> Rank: ${rankLabel} | Faithfulness: ${faithfulness} | Relevance: ${relevance}`,
    );
    if (relevance === 0) {
      console.log(`     Expected:  ${item.expected_answer}`);
      console.log(`     Generated: ${generatedAnswer.replace(/\s+/g, " ")}`);
    }
    console.log("");
  }

  const count = dataset.length;
  console.log("=======================================");
  console.log("       HARD EVALUATION RESULTS         ");
  console.log("=======================================");
  console.log(`Retrieval MRR:         ${pct(totalMRR, retrievalCount)}`);
  console.log(`Retrieval Recall@3:    ${pct(hitsAt3, retrievalCount)}`);
  console.log(`Retrieval Recall@5:    ${pct(hitsAt5, retrievalCount)}`);
  console.log("---------------------------------------");
  console.log(`Answer Faithfulness:   ${pct(totalFaithfulness, count)}`);
  console.log(`Answer Relevance:      ${pct(totalRelevance, count)}`);
  console.log("=======================================");
  console.log("            BY CATEGORY                ");
  console.log("=======================================");
  for (const [name, c] of Object.entries(categories)) {
    console.log(
      `${name.padEnd(20)} n=${String(c.count).padEnd(3)} Recall@3: ${pct(c.hits, c.retrievalCount).padEnd(7)} Faith: ${pct(c.faithfulness, c.count).padEnd(7)} Rel: ${pct(c.relevance, c.count)}`,
    );
  }
  console.log("=======================================\n");
}

runEvals().catch(console.error);
