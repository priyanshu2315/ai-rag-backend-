import fs from "fs";
import { PDFParse } from "pdf-parse";
import { pipeline } from "@xenova/transformers";
import Groq from "groq-sdk";
import "dotenv/config";

// 1. Extract text from the physical file
export const extractTextFromPDF = async (filepath) => {
  const dataBuffer = fs.readFileSync(filepath);
  const parser = new PDFParse({
    data: dataBuffer,
  });
  const data = await parser.getText();
  await parser.destroy();

  return data.text; // Returns all the text from the PDF
};

// 2. Generate Vectors
// We define this outside the function so the AI model only loads into memory once
let extractorPipeline;

export const getEmbedding = async (text) => {
  if (!extractorPipeline) {
    // This downloads a small (80MB) AI model perfectly tuned for vector search
    extractorPipeline = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }

  const output = await extractorPipeline(text, {
    pooling: "mean",
    normalize: true,
  });

  // The output is a Float32Array. We convert it to a standard JavaScript Array.
  // This will be exactly 384 numbers long.
  return Array.from(output.data);
};

// export const askOllama = async (prompt) => {
//   // Ollama runs on port 11434 by default

//   const response = await fetch("http://localhost:11434/api/generate", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       //   model: "qwen2.5:1.5b", // Or whichever model you downloaded via 'ollama run'
//       model: "phi3:mini", // Or whichever model you downloaded via 'ollama run'
//       prompt: prompt,
//       stream: false, // Wait for the full response before returning
//     }),
//   });

//   const data = await response.json();
//   return data.response;
// };

// export const askOllama = async (prompt) => {
//   const response = await fetch(
//     `${process.env.OLLAMA_BASE_URL}/api/generate`,
//     {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         model: "phi3:mini",
//         prompt,
//         stream: false,
//       }),
//     }
//   );

//   if (!response.ok) {
//     throw new Error(
//       `Ollama request failed: ${response.status} ${response.statusText}`
//     );
//   }

//   const data = await response.json();

//   return data.response;
// };

let groq = new Groq({
  apiKey: process.env.GROK_API_KEY,
});

const models = await groq.models.list();

for (const model of models.data) {
  console.log(model.id);
}
export const askLLM = async (prompt) => {
  const completion = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "openai/gpt-oss-20b",
  });
  return completion.choices[0]?.message?.content;
};
