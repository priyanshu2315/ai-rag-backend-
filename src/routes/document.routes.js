import express from "express";
import {
  uploadDocument,
  listDocuments,
  getMyDocuments,
  getAllParentChunks,
  getChildChunksOfParent,
  streamProgress,
  deleteDocument,
} from "../controllers/document.controller.js";
import { upload } from "../config/upload.js"; // Import Multer
import { requireAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Because the controller functions take (req, res), we can just pass them directly
router.post("/upload", requireAuth, upload.single("file"), uploadDocument);
router.get("/", requireAuth, listDocuments);
router.get("/my-documents", requireAuth, getMyDocuments);
router.get("/get-all-parent-chunk/:docId", requireAuth, getAllParentChunks);
router.get("/get-all-child-chunk/:parentId", requireAuth, getChildChunksOfParent);
router.get("/progress/:docId", requireAuth, streamProgress);
router.delete("/:docId", requireAuth, deleteDocument);

export default router;
