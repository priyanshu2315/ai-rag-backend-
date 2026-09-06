import express from "express";
import {
  askQuestion,
  fetchConversation,
} from "../controllers/chat.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", requireAuth, askQuestion);
router.get("/conversation", requireAuth, fetchConversation);

export default router;
