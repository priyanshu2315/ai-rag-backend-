import * as chatService from "../services/chat.service.js";

export const askQuestion = async (req, res) => {
  try {
    const { question, documentId } = req.body;
    const userId = req.user.id;

    if (!question) {
      throw new Error("Please provide a question");
    }

    const answer = await chatService.generateAnswer({
      question,
      documentId,
      userId,
    });
    console.log(answer, "answer");
    return res.status(200).json({
      success: true,
      data: { answer },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
