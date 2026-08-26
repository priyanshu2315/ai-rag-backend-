import * as chatService from "../services/chat.service.js";
import prisma from "../config/db.js";

export const askQuestion = async (req, res) => {
  try {
    const { question, documentId } = req.body;
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
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const answer = await chatService.generateAnswer(
      {
        question,
        documentId,
        userId,
      },
      (token) => {
        // SSE format requires data to be prefixed with "data: " and end with "\n\n"
        res.write(`data: ${JSON.stringify({ text: token })}\n\n`);
      },
    );
    res.write("data: [DONE]\n\n");
    res.end();
    console.log(answer, "answer");
    // return res.status(200).json({
    //   success: true,
    //   data: { answer },
    // });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
