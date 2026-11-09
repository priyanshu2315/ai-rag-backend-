import express from "express";
import documentRoutes from "./src/routes/document.routes.js";
import { startWorker } from "./src/workers/document.worker.js";
import chatRoutes from "./src/routes/chat.routes.js";
import authRoutes from "./src/routes/auth.routes.js";
import healthRoutes from "./src/routes/health.routes.js";
import pipelineRoutes from "./src/routes/pipeline.routes.js";
import roleRoutes from "./src/routes/role.routes.js";
import userRoutes from "./src/routes/user.routes.js";
import cors from "cors";

const app = express();

// Middleware to parse JSON bodies
app.use(cors());

app.use(express.json());

// Mount routes
app.use("/api/health", healthRoutes);
app.use("/api/pipeline", pipelineRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/roles", roleRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startWorker();
});
