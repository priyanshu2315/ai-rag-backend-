import * as chatService from "../services/chat.service.js";
import prisma from "../config/db.js";
import {
  canAccessDocument,
  getAccessibleDocumentIds,
} from "../services/access.service.js";
import { handle } from "../utils/http.js";

export const askQuestion = async (req, res) => {
  try {
    const { question, documentId, conversationId } = req.body;
    const userId = req.user.id;

    if (!question) {
      throw new Error("Please provide a question");
    }
    if (!conversationId) {
      return res.status(400).json({ error: "conversationId is required" });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { documentId: true },
    });
    if (
      !conversation ||
      (conversation.documentId ?? null) !== (documentId || null)
    ) {
      return res.status(404).json({ error: "Conversation not found." });
    }

    let allowedDocumentIds;
    if (documentId) {
      if (!(await canAccessDocument(req.user, documentId))) {
        return res.status(404).json({ error: "Document not found." });
      }
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
        select: { status: true },
      });

      if (doc.status === "PROCESSING") {
        return res.status(202).json({
          error:
            "Your document is still processing. Please wait a few seconds!",
        });
      }
      if (doc.status === "FAILED") {
        return res.status(500).json({
          error:
            "This document failed to process. Please try uploading it again.",
        });
      }
      allowedDocumentIds = [documentId];
    } else {
      allowedDocumentIds = await getAccessibleDocumentIds(req.user);
    }

    // 2. Set headers for Server-Sent Events (SSE)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const answer = await chatService.generateAnswer(
      {
        question,
        documentId,
        userId,
        allowedDocumentIds,
        conversationId,
      },
      (event) => {
        // Stringify the exact event object we emit from generateAnswer
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    );
    res.end();
    // return res.status(200).json({
    //   success: true,
    //   data: { answer },
    // });
  } catch (error) {
    if (res.headersSent) {
      // If streaming started, send error as an SSE event and close the connection
      res.write(
        `data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`,
      );
      res.end();
    } else {
      // If headers haven't sent yet, safely return standard JSON
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
};

// Add to src/controllers/chat.controller.js

export const fetchConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    // Extract documentId from the query string (e.g., ?documentId=...)
    const documentId = req.query.documentId || null;
    if (!documentId) {
      return res.status(400).json({
        error:
          "documentId is required; use /api/chat/conversations for global chats.",
      });
    }
    if (!(await canAccessDocument(req.user, documentId))) {
      return res.status(404).json({ error: "Document not found." });
    }

    const conversation = await chatService.getConversationSession(
      userId,
      documentId,
    );
    return res.status(200).json(conversation);
  } catch (error) {
    console.error("Failed to fetch conversation:", error);
    return res
      .status(500)
      .json({ error: "Failed to load conversation history." });
  }
};

export const clearConversation = async (req, res) => {
  try {
    const userId = req.user.id;
    const documentId = req.query.documentId || null;
    if (!documentId) {
      return res.status(400).json({
        error:
          "documentId is required; use /api/chat/conversations for global chats.",
      });
    }
    if (!(await canAccessDocument(req.user, documentId))) {
      return res.status(404).json({ error: "Document not found." });
    }

    const deletedMessages = await chatService.clearConversation(
      userId,
      documentId,
    );
    return res.status(200).json({
      success: true,
      message: "Conversation cleared.",
      data: { documentId, deletedMessages },
    });
  } catch (error) {
    console.error("Failed to clear conversation:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to clear conversation." });
  }
};

export const listConversations = handle((req) =>
  chatService.listGlobalConversations(req.user.id),
);
export const createConversation = handle(
  (req) => chatService.createGlobalConversation(req.user.id, req.body?.title),
  201,
);
export const getConversation = handle((req) =>
  chatService.getConversation(req.user, req.params.conversationId),
);
export const renameConversation = handle((req) =>
  chatService.renameConversation(
    req.user.id,
    req.params.conversationId,
    req.body?.title,
  ),
);
export const deleteConversation = handle((req) =>
  chatService.deleteGlobalConversation(req.user.id, req.params.conversationId),
);
