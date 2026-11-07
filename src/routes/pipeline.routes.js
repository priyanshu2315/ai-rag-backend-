import express from "express";
import { PIPELINE } from "../../docs/pipeline.js";

const router = express.Router();

// Public engineering timeline for the About page; docs/pipeline.js is the only copy of the content
router.get("/", (_req, res) => {
  res.status(200).json({ total: PIPELINE.length, phases: PIPELINE });
});

export default router;
