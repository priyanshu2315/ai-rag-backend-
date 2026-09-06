import * as documentRepository from "../repositories/document.repository.js";
import * as chatRepository from "../repositories/chat.repository.js";
import * as aiService from "./ai.service.js";
import { traceable } from "langsmith/traceable";

export const generateAnswer = traceable(
  async ({ question, documentId, userId, conversationId }, onEvent) => {
    // 1. Convert the user's question into a 384-number vector
    await chatRepository.saveMessage(conversationId, "user", question);
    const historyText = await chatRepository.getChatHistory(conversationId);

    // 2. Initialize the Agent's Memory
    const messages = [
      {
        role: "system",
        content: `You are an autonomous corporate assistant. You have access to a database search tool. 
      - If the user asks a factual question, you MUST use the search tool.
      - If the search results do not fully answer the question, use the tool AGAIN with a different query.
      - If the user just says hello, reply directly without searching.
      - Never hallucinate facts.
      
      CITATION RULES (CRITICAL):
    1. Every factual claim you make MUST include an inline citation using the exact [Source ID] provided in the tool response.
    2. Format citations exactly like this: "The Q3 revenue grew by 15% [Source ID: Page 4]."
    3. If a claim cannot be supported by the provided context, do not include it. Do not invent source IDs.
      `,
      },
    ];
    if (historyText) {
      messages.push({
        role: "user",
        content: `Previous Conversation Context:\n${historyText}`,
      });
      messages.push({
        role: "assistant",
        content: "Understood. I will use this context to resolve any pronouns.",
      });
    }

    messages.push({ role: "user", content: question });

    let agentFinished = false;
    let finalAnswer = "";
    let iterations = 0;
    const MAX_STEPS = 5; // Layer 1: Hard Circuit Breaker Limit
    const previousSearches = new Set();

    while (iterations < MAX_STEPS) {
      onEvent({ type: "status", message: "Model is reasoning..." });
      const response = await aiService.getAgentResponse(messages);
      const message = response.choices[0].message;
      console.log(message, "message first");

      if (message.tool_calls && message.tool_calls.length > 0) {
        console.log(
          `[Agent] Tool requested: ${message.tool_calls.length} tool(s)`,
        );
        // console.log(message.tool_calls, "tool_calls");
        // Append the AI's tool request to the message history (Required by OpenAI/Groq spec)
        messages.push(message);
        for (const toolCall of message.tool_calls) {
          console.log(toolCall, "toolCall");
          if (toolCall.function.name === "search_corporate_database") {
            const args = JSON.parse(toolCall.function.arguments);
            console.log(args, "args");
            let matchedChunks = [];
            let contextText =
              "SEARCH_RESULT: Empty. No matching information found.";
            if (args.page_number) {
              onEvent({
                type: "tool_start",
                tool: "Page Retrieval",
                query: `Fetching Page ${args.page_number}`,
              });
              matchedChunks = await chatRepository.getChunksByPage(
                documentId,
                args.page_number,
              );
              console.log(matchedChunks, "matchedChunks");
              onEvent({
                type: "tool_finish",
                tool: "Page Retrieval",
                message: `Retrieved ${matchedChunks.length} chunks.`,
              });
              if (matchedChunks.length > 0) {
                // Map with Source ID
                contextText = matchedChunks
                  .map((chunk) => {
                    const page =
                      chunk.metadata?.page_number || args.page_number;
                    return `[Source ID: Page ${page}]\n${chunk.text}`;
                  })
                  .join("\n\n---\n\n");
                messages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  name: toolCall.function.name,
                  content: contextText,
                });
              } else {
                contextText = `SEARCH_RESULT: Empty. Page ${args.page_number} does not exist in this document.`;
              }
            } else if (args.search_query) {
              onEvent({
                type: "tool_start",
                tool: "Vector Search Tool..",
                query: args.search_query,
              });
              console.log(
                `[Agent] Executing Search Tool with query: "${args.search_query}"`,
              );

              if (previousSearches.has(args.search_query)) {
                console.log(
                  `[Agent] ⚠️ Caught duplicate search: "${args.search_query}"`,
                );
                messages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  name: toolCall.function.name,
                  content:
                    "SYSTEM_ERROR: Duplicate search detected. You are in a loop. Stop searching and formulate your final answer immediately.",
                });
                continue; // Skip the vector search entirely
              }
              previousSearches.add(args.search_query);

              const queryEmbedding = await aiService.getEmbedding(
                args.search_query,
              );
              const vectorStr = `[${queryEmbedding.join(",")}]`;

              if (documentId) {
                matchedChunks = await chatRepository.searchSingleDocument(
                  documentId,
                  vectorStr,
                  args.search_query,
                  15,
                );
              } else {
                matchedChunks = await chatRepository.searchAllUserDocuments(
                  userId,
                  vectorStr,
                  args.search_query,
                  15,
                );
              }
              if (matchedChunks.length > 0) {
                const bestChunks = await aiService.rerankChunks(
                  args.search_query,
                  matchedChunks,
                  3,
                );

                onEvent({
                  type: "tool_finish",
                  tool: "Vector Search Tool..",
                  message: `Found and reranked ${bestChunks.length} relevant documents.`,
                });

                contextText = bestChunks
                  .map((chunk) => {
                    const page = chunk.metadata?.page_number || "Unknown";
                    return `[Source ID: Page ${page}]\n${chunk.text}`;
                  })
                  .join("\n\n---\n\n");
              }

              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: contextText,
              });
            }
            // 📡 EMIT TOOL START
          } else if (toolCall.function.name === "get_document_summary") {
            console.log("summary from db");
            onEvent({
              type: "tool_start",
              tool: "Summary Search",
              query: "Fetching pre-computed summary...",
            });
            let uiMessage = "Failed: No document ID provided.";
            let summaryText =
              "No document ID was provided, cannot fetch summary.";
            if (documentId) {
              const dbSummary =
                await chatRepository.getDocumentSummary(documentId);
              if (dbSummary) {
                summaryText =
                  dbSummary ||
                  "A summary is not yet available for this document.";
                uiMessage = "Successfully retrieved document summary.";
              } else {
                summaryText =
                  "A summary is not yet available for this document.";
                uiMessage = "No summary available in the database yet.";
              }
            }

            onEvent({
              type: "tool_finish",
              tool: "Summary Search",
              message: uiMessage,
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: summaryText,
            });
          }
        }
      } else {
        agentFinished = true;
        finalAnswer = message.content;
        break;
      }
      iterations++;
    }
    if (!agentFinished) {
      console.log("[Agent] 🛑 Hit MAX_STEPS limit. Forcing termination.");
      messages.push({
        role: "system",
        content:
          "SYSTEM ALERT: Maximum execution limit reached. You must stop searching immediately. Respond to the user using ONLY the information gathered so far, or explicitly state that the document does not contain the complete answer.",
      });

      // One final call to Groq to generate the string answer
      const forcedResponse = await aiService.getAgentResponse(messages);
      finalAnswer = forcedResponse.choices[0].message.content;
    }
    onEvent({ type: "status", message: "Synthesizing final response..." });
    console.log(finalAnswer, "finalAnswer");
    const words = finalAnswer?.split(" ");
    for (const word of words) {
      onEvent({ type: "token", text: word + " " });
      await new Promise((resolve) => setTimeout(resolve, 20)); // 20ms delay for smooth UI streaming
    }
    if (finalAnswer.trim()) {
      await chatRepository.saveMessage(
        conversationId,
        "assistant",
        finalAnswer,
      );
    }
    onEvent({ type: "done" });
  },
  { name: "Agent_ReAct_Loop" },
);

// export const generateAnswer = traceable(
//   async ({ question, documentId, userId, conversationId }, onToken) => {
//     // 1. Convert the user's question into a 384-number vector
//     await chatRepository.saveMessage(conversationId, "user", question);
//     const historyText = await chatRepository.getChatHistory(conversationId);

//     // 2. Initialize the Agent's Memory
//     const messages = [
//       {
//         role: "system",
//         content: `You are an autonomous corporate assistant. You have access to a database search tool.
//       - If the user asks a factual question, you MUST use the search tool.
//       - If the search results do not fully answer the question, use the tool AGAIN with a different query.
//       - If the user just says hello, reply directly without searching.
//       - Never hallucinate facts.`,
//       },
//     ];
//     if (historyText) {
//       messages.push({
//         role: "user",
//         content: `Previous Conversation Context:\n${historyText}`,
//       });
//       messages.push({
//         role: "assistant",
//         content: "Understood. I will use this context to resolve any pronouns.",
//       });
//     }

//     messages.push({ role: "user", content: question });

//     let agentFinished = false;
//     let finalAnswer = "";

//     while (!agentFinished) {
//       const response = await aiService.getAgentResponse(messages);
//       const message = response.choices[0].message;
//       console.log(message, "message first");
//       if (message.tool_calls && message.tool_calls.length > 0) {
//         console.log(
//           `[Agent] Tool requested: ${message.tool_calls.length} tool(s)`,
//         );
//         // console.log(message.tool_calls, "tool_calls");
//         // Append the AI's tool request to the message history (Required by OpenAI/Groq spec)
//         messages.push(message);
//         for (const toolCall of message.tool_calls) {
//           console.log(toolCall, "toolCall");
//           if (toolCall.function.name === "search_corporate_database") {
//             const args = JSON.parse(toolCall.function.arguments);
//             console.log(
//               `[Agent] Executing Search Tool with query: "${args.search_query}"`,
//             );
//             const queryEmbedding = await aiService.getEmbedding(
//               args.search_query,
//             );
//             const vectorStr = `[${queryEmbedding.join(",")}]`;

//             let matchedChunks = [];
//             if (documentId) {
//               matchedChunks = await chatRepository.searchSingleDocument(
//                 documentId,
//                 vectorStr,
//                 args.search_query,
//                 15,
//               );
//             } else {
//               matchedChunks = await chatRepository.searchAllUserDocuments(
//                 userId,
//                 vectorStr,
//                 args.search_query,
//                 15,
//               );
//             }
//             let contextText =
//               "No relevant results found in the database for this query.";
//             if (matchedChunks.length > 0) {
//               const bestChunks = await aiService.rerankChunks(
//                 args.search_query,
//                 matchedChunks,
//                 3,
//               );
//               contextText = bestChunks
//                 .map((chunk) => chunk.text)
//                 .join("\n\n---\n\n");
//             }
//             messages.push({
//               role: "tool",
//               tool_call_id: toolCall.id,
//               name: toolCall.function.name,
//               content: contextText,
//             });
//           } else if (toolCall.function.name === "get_document_summary") {
//             console.log("summary from db");
//             let summaryText =
//               "No document ID was provided, cannot fetch summary.";
//             if (documentId) {
//               const dbSummary =
//                 await chatRepository.getDocumentSummary(documentId);
//               summaryText =
//                 dbSummary ||
//                 "A summary is not yet available for this document.";
//             }

//             messages.push({
//               role: "tool",
//               tool_call_id: toolCall.id,
//               name: toolCall.function.name,
//               content: summaryText,
//             });
//           }
//         }
//       } else {
//         agentFinished = true;
//         finalAnswer = message.content;
//       }
//     }
//     const words = finalAnswer.split(" ");
//     for (const word of words) {
//       onToken(word + " ");
//       await new Promise((resolve) => setTimeout(resolve, 20)); // 20ms delay for smooth UI streaming
//     }
//     if (finalAnswer.trim()) {
//       await chatRepository.saveMessage(
//         conversationId,
//         "assistant",
//         finalAnswer,
//       );
//     }
//   },
//   { name: "Agent_ReAct_Loop" },
// );

// export const generateAnswer = async (
//   { question, documentId, userId, conversationId },
//   onToken,
// ) => {
//   // 1. Convert the user's question into a 384-number vector
//   await chatRepository.saveMessage(conversationId, "user", question);
//   const historyText = await chatRepository.getChatHistory(conversationId);

//   const intent = await aiService.classifyIntent(question);
//   console.log(`Detected Intent: ${intent}`);

//   let fullAnswer = "";
//   const tokenCollector = (token) => {
//     fullAnswer += token;
//     onToken(token);
//   };

//   if (intent == "GREETING") {
//     await aiService.askLLM(
//       `You are a helpful AI. Reply to: ${question}`,
//       tokenCollector,
//     );
//   } else if (intent == "GLOBAL_SUMMARIZE") {
//     if (!documentId) {
//       tokenCollector("I need a specific document to generate a summary.");
//     } else {
//       const summary = await chatRepository.getDocumentSummary(documentId);
//       if (!summary) {
//         tokenCollector(
//           "I'm sorry, but a summary has not been generated for this document yet.",
//         );
//       } else {
//         // 2. Stream the pre-computed summary back to the user
//         await aiService.askLLM(
//           `Present this pre-computed document summary to the user clearly and professionally. Do not change the facts, just format it well:\n\n${summary}`,
//           tokenCollector,
//         );
//       }
//     }
//   } else {
//     const optimizedQuery = await aiService.rewriteQuery(question, historyText);
//     console.log(`Optimized Query: ${optimizedQuery}`);
//     const queryEmbedding = await aiService.getEmbedding(optimizedQuery);
//     const vectorStr = `[${queryEmbedding.join(",")}]`;
//     let matchedChunks = [];
//     if (documentId) {
//       matchedChunks = await chatRepository.searchSingleDocument(
//         documentId,
//         vectorStr,
//         optimizedQuery,
//         15,
//       );
//     } else {
//       matchedChunks = await chatRepository.searchAllUserDocuments(
//         userId,
//         vectorStr,
//         optimizedQuery,
//         15,
//       );
//     }
//     if (!matchedChunks.length) {
//       tokenCollector(
//         "I could not find any relevant information to answer this question.",
//       );
//     } else {
//       const bestChunks = await aiService.rerankChunks(
//         optimizedQuery,
//         matchedChunks,
//         3,
//       );
//       const context = bestChunks.map((chunk) => chunk.text).join("\n\n---\n\n");

//       const prompt = `You are an expert assistant. Answer based ONLY on context.
// Context:
// ${context}

// Question:
// ${question}

// Answer:`;
//       await aiService.askLLM(prompt, tokenCollector);
//     }
//   }

//   if (fullAnswer.trim()) {
//     await chatRepository.saveMessage(conversationId, "assistant", fullAnswer);
//   }
// };

// export const generateAnswer = async (
//   { question, documentId, userId },
//   onToken,
// ) => {
//   // 1. Convert the user's question into a 384-number vector
//   console.log(`Embedding question: "${question}"`);
//   const queryEmbedding = await aiService.getEmbedding(question);
//   const vectorStr = `[${queryEmbedding.join(",")}]`;

//   let matchedChunks = [];

//   if (documentId) {
//     // Verify document exists and belongs to the requesting user
//     const doc = await documentRepository.getDocumentById(documentId);
//     if (!doc || doc.userId !== userId) {
//       const error = new Error("Document not found or unauthorized");
//       error.statusCode = 403;
//       throw error;
//     }

//     matchedChunks = await chatRepository.searchSingleDocument(
//       documentId,
//       vectorStr,
//       question,
//       5,
//     );
//   } else {
//     // Search across all documents belonging to this user
//     matchedChunks = await chatRepository.searchAllUserDocuments(
//       userId,
//       vectorStr,
//       question,
//     );
//   }

//   const bestChunks = await aiService.rerankChunks(question, matchedChunks, 3);

//   // 2. Search Postgres for the top 3 most relevant paragraphs from your PDFs
//   const context = bestChunks.map((chunk) => chunk.text).join("\n\n---\n\n");
//   console.log(context, "context");
//   if (!context.trim()) {
//     return "I could not find any relevant information in your documents to answer this question.";
//   }
//   // 3. Construct the prompt for Ollama
//   // We strictly tell the AI to ONLY use our PDF context to prevent hallucination.
//   // const prompt = `
//   //   You are a helpful assistant. Use the following pieces of context to answer the user's question.
//   //   If the answer is not in the context, just say that you don't know, don't try to make up an answer.

//   //   Context:
//   //   ${context}

//   //   Question: ${question}

//   //   Answer:
//   // `;

//   const prompt = `You are an expert corporate risk and compliance assistant.
// Your job is to provide the final, authoritative answer based ONLY on the provided context.

// Follow these strict rules for resolving conflicts:
// 1. PRECEDENCE: If an Amendment or later section overrides an earlier rule, the Amendment is the absolute truth. Discard the old rule.
// 2. CONCISENESS: Provide the direct, final answer immediately. Do NOT explain the history of the rule or how it was amended unless explicitly asked.
// 3. SPECIFICITY: Pay close attention to entity types.

// Context:
// ${context}

// Question:
// ${question}

// Answer:`;

//   // 4. Send it to Ollama!
//   console.log("Asking llm...");
//   const answer = await aiService.askLLM(prompt, onToken);

//   return answer;
// };

// Add this exported function

export const getConversationSession = async (userId, documentId) => {
  return await chatRepository.getOrCreateConversation(userId, documentId);
};
