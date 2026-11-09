import express from "express";
import {
  login,
  forgotPassword,
  resetPassword,
  changePassword,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", requireAuth, changePassword);

export default router;
