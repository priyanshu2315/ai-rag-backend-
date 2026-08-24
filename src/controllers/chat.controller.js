import * as chatService from "../services/chat.service.js";

export const askQuestion = async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      throw new Error("Please provide a question");
    }

    const answer = await chatService.generateAnswer(question);
    console.log(answer, "answer");
    return res.status(200).json({
      success: true,
      question: question,
      answer: answer,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
