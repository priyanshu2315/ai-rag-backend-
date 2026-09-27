import express from "express";

const router = express.Router();

router.get("/", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

export default router;
