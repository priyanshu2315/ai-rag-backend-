import express from "express";
import {
  askQuestion,
  fetchConversation,
  clearConversation,
  listConversations,
  createConversation,
  getConversation,
  renameConversation,
  deleteConversation,
} from "../controllers/chat.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", requireAuth, askQuestion);
router.get("/conversation", requireAuth, fetchConversation);
router.delete("/conversation", requireAuth, clearConversation);
router.get("/conversations", requireAuth, listConversations);
router.post("/conversations", requireAuth, createConversation);
router.get("/conversations/:conversationId", requireAuth, getConversation);
router.patch("/conversations/:conversationId", requireAuth, renameConversation);
router.delete(
  "/conversations/:conversationId",
  requireAuth,
  deleteConversation,
);
export default router;
