import express from "express";
import {
  uploadDocument,
  listDocuments,
  getMyDocuments,
  getAllParentChunks,
  getChildChunksOfParent,
} from "../controllers/document.controller.js";
import { upload } from "../config/upload.js"; // Import Multer
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Because the controller functions take (req, res), we can just pass them directly
router.post("/upload", requireAuth, upload.single("file"), uploadDocument);
router.get("/", requireAuth, listDocuments);
router.get("/my-documents", requireAuth, getMyDocuments);
router.get("/get-all-parent-chunk/:docId", getAllParentChunks);
router.get("/get-all-child-chunk/:parentId", getChildChunksOfParent);

export default router;
