import express from "express";
import {
  uploadDocument,
  listDocuments,
} from "../controllers/document.controller.js";
import { upload } from "../config/upload.js"; // Import Multer

const router = express.Router();

// Because the controller functions take (req, res), we can just pass them directly
router.post("/upload", upload.single("file"), uploadDocument);
router.get("/", listDocuments);

export default router;
