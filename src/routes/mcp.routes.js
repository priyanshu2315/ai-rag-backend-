import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireAuth } from "../middlewares/auth.middleware.js";
import { buildMcpServer } from "../mcp/mcp.server.js";

const router = express.Router();

// Stateless: every request builds its own server and transport and nothing is
// stored between requests, so any server behind a load balancer can answer.
// The user comes from the JWT on each request, so role rules still apply.
router.post("/", requireAuth, async (req, res) => {
  try {
    const server = buildMcpServer(req.user);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // no session ID
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

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

// No server-to-client stream and no session to end in stateless mode.
const notAllowed = (req, res) =>
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed (stateless server)" },
    id: null,
  });
router.get("/", requireAuth, notAllowed);
router.delete("/", requireAuth, notAllowed);

export default router;
