import express from "express";
import { askQuestion } from "../controllers/chat.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/", requireAuth, askQuestion);

export default router;
