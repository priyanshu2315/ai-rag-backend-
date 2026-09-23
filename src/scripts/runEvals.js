import fs from "fs";
import path from "path";

// 1. Import your actual search function and config
// (Update this path to wherever your hybrid search function lives)
import * as aiService from "./../services/ai.service.js";
import { llm, MODELS } from "../config/ai.js";
import { searchSingleDocument } from "../repositories/chat.repository.js";
import { fileURLToPath } from "url";
// 2. Initialize the LLM client (Groq is perfect for fast, cheap evals)

const TEST_DOC_ID = "00000000-0000-0000-0000-000000000002";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
async function runEvals() {
  const datasetPath = path.resolve(__dirname, "../evals/goldenDataSet.js");
  //   const datasetPath1 = path.resolve(".");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

  let totalMRR = 0;
  let hitsAt3 = 0;
  let hitsAt5 = 0;
  let totalFaithfulness = 0;
  let totalRelevance = 0;

  console.log(
    `Starting Evaluation Harness for ${dataset.length} questions...\n`,
  );

  for (let i = 0; i < dataset.length; i++) {
    const item = dataset[i];
    console.log(`[Q${i + 1}/${dataset.length}] Evaluating: "${item.question}"`);

    // ==========================================
    // STEP 1: TEST RETRIEVAL (Search)
    // ==========================================
    // Call your actual production search function.
    // (Adjust the parameters to match how your function works)
    const queryVectorArray = await aiService.getEmbedding(item.question);
    const vectorStr = `[${queryVectorArray.join(",")}]`;

    // 1b. Call your actual RRF hybrid search function
    const searchResults = await searchSingleDocument(
      TEST_DOC_ID,
      vectorStr, // The embedding we just generated
      item.question, // The plain text keyword query
      15, // Count
    );

    // const bestChunks = await aiService.rerankChunks(
    //   item.question,
    //   searchResults,
    //   3,
    // );
    // 1c. Find the rank of the correct chunk based on the ID
    const hitIndex = searchResults.findIndex(
      (chunk) => chunk.id === item.target_parent_chunk_id,
    );

    let rank = 0;
    if (hitIndex !== -1) {
      rank = hitIndex + 1;
      totalMRR += 1 / rank;
      if (rank <= 3) hitsAt3++;
      if (rank <= 5) hitsAt5++;
    }

    // ==========================================
    // STEP 2: TEST GENERATION (LLM Agent)
    // ==========================================
    const contextText = searchResults.map((c) => c.text).join("\n\n---\n\n");

    // Have the LLM generate an answer using the retrieved context
    const agentResponse = await llm.chat.completions.create({
      model: MODELS.agent, // <-- Perfectly in sync with your production code
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

    // ==========================================
    // STEP 3: THE JUDGE (Score the Answer)
    // ==========================================
    const judgePrompt = `
      You are an impartial AI judge. Evaluate the Generated Answer based on two criteria:
      1. Faithfulness (0 or 1): Is the Generated Answer strictly derived from the Context? (0 if hallucinated).
      2. Relevance (0 or 1): Does the Generated Answer actually answer the Question and match the Expected Answer?

      Context: ${contextText}
      Question: ${item.question}
      Expected Answer: ${item.expected_answer}
      Generated Answer: ${generatedAnswer}

      Return ONLY a JSON object: {"faithfulness": 1, "relevance": 1}
    `;

    const judgeResponse = await llm.chat.completions.create({
      model: MODELS.agent, // Use a smarter model for the judge
      messages: [{ role: "user", content: judgePrompt }],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const scores = JSON.parse(judgeResponse.choices[0].message.content);
    totalFaithfulness += scores.faithfulness || 0;
    totalRelevance += scores.relevance || 0;

    console.log(
      `  -> Rank: ${rank > 0 ? rank : "MISS"} | Faithfulness: ${scores.faithfulness} | Relevance: ${scores.relevance}\n`,
    );
  }

  // ==========================================
  // FINAL SCORE DASHBOARD
  // ==========================================
  const count = dataset.length;
  console.log("=======================================");
  console.log("         EVALUATION RESULTS            ");
  console.log("=======================================");
  console.log(
    `Retrieval MRR:         ${((totalMRR / count) * 100).toFixed(1)}%`,
  );
  console.log(
    `Retrieval Recall@3:    ${((hitsAt3 / count) * 100).toFixed(1)}%`,
  );
  console.log(
    `Retrieval Recall@5:    ${((hitsAt5 / count) * 100).toFixed(1)}%`,
  );
  console.log("---------------------------------------");
  console.log(
    `Answer Faithfulness:   ${((totalFaithfulness / count) * 100).toFixed(1)}%`,
  );
  console.log(
    `Answer Relevance:      ${((totalRelevance / count) * 100).toFixed(1)}%`,
  );
  console.log("=======================================\n");
}

runEvals().catch(console.error);
