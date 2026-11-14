import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const router = express.Router();
const ARCHITECTURE_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/architecture.html",
);

// Public architecture map (HTML page with one SVG); docs/architecture.html is the only copy
router.get("/", (_req, res) => {
  res.type("html").sendFile(ARCHITECTURE_FILE);
});

export default router;
