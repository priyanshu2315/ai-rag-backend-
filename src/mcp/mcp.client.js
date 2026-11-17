import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// The MCP servers CRAG may use. A new source = one entry here, no new code.
export const MCP_SERVERS = [
  {
    name: "tavily",
    url: "https://mcp.tavily.com/mcp/",
    headers: () => ({ Authorization: `Bearer ${process.env.TAVILY_API_KEY}` }),
    allowedTools: ["tavily_search", "tavily_extract"], // crawl/map/research: slow and costly
    maxChars: 6000,
  },
];

// One connection per server, opened on first use and then reused.
const connections = new Map(); // name -> Promise<Client>

function getClient(server) {
  if (!connections.has(server.name)) {
    const client = new Client({ name: "ai-rag-crag", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: server.headers() },
    });
    const ready = client.connect(transport).then(() => client);
    ready.catch(() => connections.delete(server.name)); // failed: try again next time
    connections.set(server.name, ready);
  }
  return connections.get(server.name);
}

// MCP tool results are content blocks; the agent wants plain text.
const toText = (result) =>
  (result.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

const cut = (text, max) =>
  text.length > max ? `${text.slice(0, max)}...` : text;

// All tools of one server, in the same { definition, run } shape as webTools.
export async function getMcpTools(serverName) {
  const server = MCP_SERVERS.find((s) => s.name === serverName);
  if (!server) throw new Error(`Unknown MCP server: ${serverName}`);

  const client = await getClient(server);
  let tools;
  try {
    ({ tools } = await client.listTools());
  } catch (error) {
    connections.delete(server.name); // stale connection: reconnect next time
    throw error;
  }

  const registry = {};
  for (const tool of tools) {
    if (server.allowedTools && !server.allowedTools.includes(tool.name))
      continue;

    registry[tool.name] = {
      mcpServer: server.name, // lets the UI show "MCP: tavily"

      definition: {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema,
        },
      },
      run: async (args) => {
        const result = await client.callTool({
          name: tool.name,
          arguments: args,
        });
        const text = cut(toText(result), server.maxChars ?? 6000);
        return result.isError ? { error: text || "Tool failed" } : { text };
      },
    };
  }
  return registry;
}
