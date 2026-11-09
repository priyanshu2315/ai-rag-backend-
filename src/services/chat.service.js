
import * as chatRepository from "../repositories/chat.repository.js";
import * as aiService from "./ai.service.js";
import { traceable } from "langsmith/traceable";
import { cragPipeline } from "./crag.service.js"; // Import your new graph
import { httpError } from "../utils/http.js";
import { canAccessDocument } from "./access.service.js";

export const generateAnswer = traceable(
  async (
    { question, documentId, userId, conversationId, allowedDocumentIds },
    onEvent,
  ) => {
    // 1. Intent Firewall (Unchanged)
    onEvent({ type: "status", message: "Running security checks..." });
    const intentStatus = await aiService.checkMaliciousIntent(question);
    if (intentStatus === "MALICIOUS") {
      const refusalMessage =
        "I cannot fulfill this request as it violates my safety guidelines.";
      await chatRepository.saveMessage(conversationId, "user", question);
      await chatRepository.saveMessage(
        conversationId,
        "assistant",
        refusalMessage,
      );

      const words = refusalMessage.split(" ");
      for (const word of words) {
        onEvent({ type: "token", text: word + " " });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      onEvent({ type: "done" });
      return;
    }

    // 2. Load History
    const historyText = await chatRepository.getChatHistory(conversationId);
    await chatRepository.saveMessage(conversationId, "user", question);
    await chatRepository.touchConversation(conversationId, question);

    // 3. Invoke the LangGraph State Machine
    onEvent({ type: "status", message: "Processing your question..." });

    // Collect trace steps for historical viewing (exclude streaming tokens to keep DB light)
    const traceSteps = [];
    const eventCollector = (event) => {
      onEvent(event); // Stream to UI in real time
      if (event.type !== "token") {
        traceSteps.push(event); // Save step in metadata
      }
    };

    // The graph handles the retrieval, grading, rewriting, and generating.
    const finalState = await cragPipeline.invoke(
      {
        question: question,
        documents: [],
        loopCount: 0,
        documentId: documentId,
        userId: userId,
        allowedDocumentIds: allowedDocumentIds,
        historyText: historyText,
      },
      { configurable: { onEvent: eventCollector } },
    );

    const finalAnswer = finalState?.generation || "";
    const citations = finalState?.citations || [];
    const reasoningChain = finalState?.reasoningChain || null;

    // 4. Stream and Save
    onEvent({ type: "status", message: "Synthesizing final response..." });
    const words = finalAnswer.split(" ");
    for (const word of words) {
      onEvent({ type: "token", text: word + " " });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    if (finalAnswer.trim()) {
      await chatRepository.saveMessage(
        conversationId,
        "assistant",
        finalAnswer,
        {
          citations,
          steps: traceSteps,
          reasoningChain,
        },
      );
    }
    onEvent({ type: "done" });
  },
  { name: "Agent_CRAG_Pipeline" },
);

export const getConversationSession = async (userId, documentId) => {
  return await chatRepository.getOrCreateConversation(userId, documentId);
};

export const clearConversation = async (userId, documentId) => {
  return await chatRepository.clearConversationMessages(userId, documentId);
};

const cleanTitle = (title) => {
  const value = typeof title === "string" ? title.trim() : "";
  if (!value) throw httpError(400, "Title is required");
  if (value.length > 120) throw httpError(400, "Title is too long");
  return value;
};

export const listGlobalConversations = (userId) =>
  chatRepository.listGlobalConversations(userId);

export const createGlobalConversation = (userId, title) =>
  chatRepository.createGlobalConversation(
    userId,
    title === undefined ? undefined : cleanTitle(title),
  );

export const getConversation = async (user, id) => {
  const conversation = await chatRepository.getOwnedConversation(user.id, id);
  if (!conversation) throw httpError(404, "Conversation not found");
  if (
    conversation.documentId &&
    !(await canAccessDocument(user, conversation.documentId))
  ) {
    throw httpError(404, "Conversation not found");
  }
  return conversation;
};

export const renameConversation = async (userId, id, title) => {
  const cleaned = cleanTitle(title);
  const result = await chatRepository.renameConversation(userId, id, cleaned);
  if (!result.count) throw httpError(404, "Conversation not found");
  return { id, title: cleaned };
};

export const deleteGlobalConversation = async (userId, id) => {
  const result = await chatRepository.deleteGlobalConversation(userId, id);
  if (!result.count) throw httpError(404, "Conversation not found");
  return { success: true };
};
