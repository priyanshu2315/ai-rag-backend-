import express from "express";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware.js";
import {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  setRoleDocuments,
} from "../controllers/role.controller.js";

const router = express.Router();
router.use(requireAuth, requireAdmin); // every role route is admin only

router.get("/", listRoles);
router.get("/:roleId", getRole);
router.post("/", createRole);
router.patch("/:roleId", updateRole);
router.delete("/:roleId", deleteRole);
router.put("/:roleId/documents", setRoleDocuments);

export default router;
