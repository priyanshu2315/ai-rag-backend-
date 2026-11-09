import express from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  setUserRoles,
  resetUserPassword,
} from "../controllers/user.controller.js";

const router = express.Router();
router.use(requireAuth, requireAdmin); // every user route is admin only

router.get("/", listUsers);
router.get("/:userId", getUser);
router.post("/", createUser);
router.patch("/:userId", updateUser);
router.put("/:userId/roles", setUserRoles);
router.post("/:userId/reset-password", resetUserPassword);

export default router;
