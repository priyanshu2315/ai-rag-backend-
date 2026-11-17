import { randomUUID } from "node:crypto";
// (keep your other imports)
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { buildMcpServer } from "../mcp/mcp.server.js";

const router = express.Router();

// sessionId -> { transport, userId }. In memory: a restart drops all
// sessions and clients simply reconnect.
const sessions = new Map();

// Finds the caller's session; a session belongs to the user who opened it.
function findSession(req, res) {
  const sessionId = req.headers["mcp-session-id"];
  const session = sessions.get(sessionId);
  if (!session || session.userId !== req.user.id) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
    return null;
  }
  return session;
}

router.post("/", requireAuth, async (req, res) => {
  try {
    // 1. Known session: pass the message to its transport
    if (req.headers["mcp-session-id"]) {
      const session = findSession(req, res);
      if (session) await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // 2. No session: only "initialize" may start one
    if (!isInitializeRequest(req.body)) {
      return res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Send initialize first" },
        id: null,
      });
    }

    const server = buildMcpServer(req.user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, userId: req.user.id });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
      server.close();
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP] request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// GET = open a stream for server messages; DELETE = end the session.
const sessionRequest = async (req, res) => {
  const session = findSession(req, res);
  if (session) await session.transport.handleRequest(req, res);
};
router.get("/", requireAuth, sessionRequest);
router.delete("/", requireAuth, sessionRequest);

export default router;
