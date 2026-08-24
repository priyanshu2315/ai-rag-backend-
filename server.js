import express from "express";
import documentRoutes from "./src/routes/document.routes.js";
import { startWorker } from "./src/workers/document.worker.js";
import chatRoutes from "./src/routes/chat.routes.js";
import cors from "cors";

const app = express();

// Middleware to parse JSON bodies
app.use(cors());

app.use(express.json());

// Mount routes
app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startWorker();
});
