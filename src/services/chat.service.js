import * as documentRepository from "../repositories/document.repository.js";
import * as chatRepository from "../repositories/chat.repository.js";
import * as aiService from "./ai.service.js";

export const generateAnswer = async ({ question, documentId, userId }) => {
  // 1. Convert the user's question into a 384-number vector
  console.log(`Embedding question: "${question}"`);
  const queryEmbedding = await aiService.getEmbedding(question);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  let matchedChunks = [];

  if (documentId) {
    // Verify document exists and belongs to the requesting user
    const doc = await documentRepository.getDocumentById(documentId);
    if (!doc || doc.userId !== userId) {
      const error = new Error("Document not found or unauthorized");
      error.statusCode = 403;
      throw error;
    }

    matchedChunks = await chatRepository.searchSingleDocument(
      documentId,
      vectorStr,
      question,
      8,
    );
  } else {
    // Search across all documents belonging to this user
    matchedChunks = await chatRepository.searchAllUserDocuments(
      userId,
      vectorStr,
      question,
    );
  }

  // 2. Search Postgres for the top 3 most relevant paragraphs from your PDFs
  const context = matchedChunks.map((chunk) => chunk.text).join("\n\n---\n\n");

  if (!context.trim()) {
    return "I could not find any relevant information in your documents to answer this question.";
  }
  // 3. Construct the prompt for Ollama
  // We strictly tell the AI to ONLY use our PDF context to prevent hallucination.
  const prompt = `
    You are a helpful assistant. Use the following pieces of context to answer the user's question. 
    If the answer is not in the context, just say that you don't know, don't try to make up an answer.
    
    Context:
    ${context}
    
    Question: ${question}
    
    Answer:
  `;

  // 4. Send it to Ollama!
  console.log("Asking llm...");
  const answer = await aiService.askLLM(prompt);

  return answer;
};
