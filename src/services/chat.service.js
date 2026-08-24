import * as documentRepository from "../repositories/document.repository.js";
import * as aiService from "./ai.service.js";

export const generateAnswer = async (question) => {
  // 1. Convert the user's question into a 384-number vector
  console.log(`Embedding question: "${question}"`);
  const questionVector = await aiService.getEmbedding(question);

  // 2. Search Postgres for the top 3 most relevant paragraphs from your PDFs
  console.log("Searching PostgreSQL for context...");
  const relevantChunks =
    await documentRepository.findSimilarChunks(questionVector);

  // Extract just the text strings from the database result
  const contextText = relevantChunks.map((chunk) => chunk.text).join("\n\n");
  console.log(contextText, "contextText");
  // 3. Construct the prompt for Ollama
  // We strictly tell the AI to ONLY use our PDF context to prevent hallucination.
  const prompt = `
    You are a helpful assistant. Use the following pieces of context to answer the user's question. 
    If the answer is not in the context, just say that you don't know, don't try to make up an answer.
    
    Context:
    ${contextText}
    
    Question: ${question}
    
    Answer:
  `;

  // 4. Send it to Ollama!
  console.log("Asking Ollama...");
  const answer = await aiService.askLLM(prompt);

  return answer;
};
