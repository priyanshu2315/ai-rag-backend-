import * as chatService from "../services/chat.service.js";
import prisma from "../config/db.js";

export const askQuestion = async (req, res) => {
  try {
    const { question, documentId, conversationId } = req.body;
    const userId = req.user.id;

    if (!question) {
      throw new Error("Please provide a question");
    }

    if (documentId) {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
      });

      if (!doc) {
        return res.status(404).json({ error: "Document not found." });
      }

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
