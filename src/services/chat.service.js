import * as chatRepository from "../repositories/chat.repository.js";
import * as aiService from "./ai.service.js";
import { traceable } from "langsmith/traceable";
import { cragPipeline } from "./crag.service.js"; // Import your new graph
import { httpError } from "../utils/http.js";
import { canAccessDocument } from "./access.service.js";
import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";
import { checkpointer } from "../config/checkpointer.js";

const WAITING_TEXT = "I need your approval to search the web before I answer.";

// Sends the answer word by word (same as before).
async function streamWords(text, onEvent) {
  for (const word of text.split(" ")) {
    onEvent({ type: "token", text: word + " " });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// Streams events to the UI and keeps non-token events for metadata.steps.
function createCollector(onEvent, previousSteps = []) {
  const steps = [...previousSteps];
  const collect = (event) => {
    onEvent(event);
    if (event.type !== "token") steps.push(event);
  };
  return { steps, collect };
}

// A paused run returns __interrupt__ with what ask_approval passed to interrupt().
const getPause = (state) => state?.__interrupt__?.[0]?.value ?? null;

// Paused: tell the UI, save a "waiting" message, close the stream.
async function savePause({
  pause,
  threadId,
  conversationId,
  steps,
  collect,
  onEvent,
}) {
  const webHops = pause.webHops ?? [];
  collect({
    type: "approval_required",
    threadId,
    question: pause.question,
    webHops,
    message: WAITING_TEXT,
  });
  await chatRepository.saveMessage(conversationId, "assistant", WAITING_TEXT, {
    status: "awaiting_approval",
    threadId,
    webHops,
    steps,
  });
  onEvent({ type: "done" });
}

// Finished: stream and save the answer (or replace the waiting message),
// then delete the run's checkpoints, which are only needed while paused.
async function finishAnswer({
  finalState,
  conversationId,
  threadId,
  steps,
  onEvent,
  waitingMessageId = null,
}) {
  const finalAnswer = finalState?.generation || "";

  onEvent({ type: "status", message: "Synthesizing final response..." });
  await streamWords(finalAnswer, onEvent);

  if (finalAnswer.trim()) {
    const metadata = {
      citations: finalState?.citations || [],
      steps,
      reasoningChain: finalState?.reasoningChain || null,
      ...(finalState?.webApproval != null && {
        webApproval: finalState.webApproval,
      }),
      ...(finalState?.webFacts && { webFacts: finalState.webFacts }), 
    };
    if (waitingMessageId) {
      await chatRepository.updateMessage(waitingMessageId, {
        content: finalAnswer,
        metadata,
      });
    } else {
      await chatRepository.saveMessage(
        conversationId,
        "assistant",
        finalAnswer,
        metadata,
      );
    }
  }

  await checkpointer
    .deleteThread(threadId)
    .catch((error) =>
      console.error(
        "[Checkpointer] deleteThread failed",
        threadId,
        error.message,
      ),
    );
  onEvent({ type: "done" });
}

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

    // 3. Invoke the LangGraph State Machine (each question = its own saved run)
    onEvent({ type: "status", message: "Processing your question..." });
    const threadId = randomUUID();
    const { steps, collect } = createCollector(onEvent);

    const finalState = await cragPipeline.invoke(
      {
        question,
        documents: [],
        loopCount: 0,
        documentId,
        userId,
        allowedDocumentIds,
        historyText,
      },
      { configurable: { thread_id: threadId, onEvent: collect } },
    );

    // 4a. Paused for approval
    const pause = getPause(finalState);
    if (pause) {
      await savePause({
        pause,
        threadId,
        conversationId,
        steps,
        collect,
        onEvent,
      });
      return;
    }

    // 4b. Finished
    await finishAnswer({
      finalState,
      conversationId,
      threadId,
      steps,
      onEvent,
    });
  },
  { name: "Agent_CRAG_Pipeline" },
);

// Checks before streaming: the user owns the chat, still has access,
// and this run is really waiting. Throws 404/409 as JSON errors.
export const claimApproval = async (user, conversationId, threadId) => {
  const conversation = await chatRepository.getOwnedConversation(
    user.id,
    conversationId,
  );
  if (!conversation) throw httpError(404, "Conversation not found");
  if (
    conversation.documentId &&
    !(await canAccessDocument(user, conversation.documentId))
  ) {
    throw httpError(404, "Conversation not found");
  }

  const waiting = await chatRepository.findWaitingMessage(
    conversationId,
    threadId,
  );
  if (!waiting) throw httpError(404, "No question is waiting for approval");
  if (!(await chatRepository.claimWaitingMessage(waiting))) {
    throw httpError(409, "This approval was already answered");
  }
  return waiting;
};

// Continues the paused run with the user's decision.
export const resumeAnswer = traceable(
  async ({ conversationId, threadId, approved, waiting }, onEvent) => {
    // Keep the trace from before the pause, then add the rest.
    const { steps, collect } = createCollector(
      onEvent,
      waiting.metadata?.steps ?? [],
    );
    collect({ type: "approval_result", threadId, approved });

    try {
      const finalState = await cragPipeline.invoke(
        new Command({ resume: { approved } }),
        { configurable: { thread_id: threadId, onEvent: collect } },
      );
      await finishAnswer({
        finalState,
        conversationId,
        threadId,
        steps,
        onEvent,
        waitingMessageId: waiting.id,
      });
    } catch (error) {
      // Put it back to "waiting" so the user can try again.
      await chatRepository.updateMessage(waiting.id, {
        metadata: waiting.metadata,
      });
      throw error;
    }
  },
  { name: "Agent_CRAG_Resume" },
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
