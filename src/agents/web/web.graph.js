// src/agents/web/web.graph.js
// The same web research agent as web.agent.js, built as a LangGraph graph:
//   START -> agent -> (tool calls? -> tools -> agent) -> END
// A graph can later be paused (interrupt) and resumed (checkpointer).
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { chatCompletion } from "../../config/ai.js";
import { webTools } from "./web.tools.js";
import {
  MAX_STEPS,
  SYSTEM_PROMPT,
  runToolCall,
  collectSources,
} from "./web.agent.js";
import { getMcpTools } from "../../mcp/mcp.client.js";

// State: what the graph remembers between nodes.
// reducer = how a node's return value is merged into the state.
const WebAgentState = Annotation.Root({
  maxSteps: Annotation({ reducer: (x, y) => y, default: () => MAX_STEPS }),
  messages: Annotation({ reducer: (x, y) => x.concat(y), default: () => [] }), // append
  stepCount: Annotation({ reducer: (x, y) => x + y, default: () => 0 }), // add
  steps: Annotation({ reducer: (x, y) => x.concat(y), default: () => [] }), // append
  sources: Annotation({
    reducer: (x, y) => [...new Set([...x, ...y])],
    default: () => [],
  }), // union
  answer: Annotation({ reducer: (x, y) => y, default: () => "" }),
  stopReason: Annotation({ reducer: (x, y) => y, default: () => "" }),
});

// Node 1: ask the model (answer, or which tools next?)
async function agentNode(state, config) {
  const registry = config.configurable.tools;

  const step = state.stepCount + 1;
  const lastStep = step >= state.maxSteps;

  const extra = [];
  if (lastStep) {
    extra.push({
      role: "user",
      content:
        "Step limit reached. Answer now using only what you found so far.",
    });
  }

  const response = await chatCompletion("agent", {
    messages: [...state.messages, ...extra],
    temperature: 0,
    ...(lastStep
      ? {}
      : {
          tools: Object.values(registry).map((t) => t.definition),
          tool_choice: "auto",
        }),
  });
  const message = response.choices[0].message;
  const toolCalls = message.tool_calls ?? [];

  const assistant = toolCalls.length
    ? {
        role: "assistant",
        content: message.content ?? "",
        tool_calls: toolCalls,
      }
    : { role: "assistant", content: message.content ?? "" };

  return {
    messages: [...extra, assistant],
    stepCount: 1, // reducer adds 1
    ...(toolCalls.length === 0 && {
      answer: message.content?.trim() || "",
      stopReason: lastStep ? "step_limit" : "done",
    }),
  };
}

// Node 2: run the tools the model asked for
async function toolsNode(state, config) {
  const last = state.messages.at(-1);
  const results = await Promise.all(
    last.tool_calls.map((call) => runToolCall(call, config.configurable.tools)),
  );

  const sources = new Set();
  results.forEach((r) => collectSources(r.output, sources));

  const steps = results.map((r) => ({
    step: state.stepCount,
    tool: r.name,
    args: r.args,
    ok: !r.output.error,
    mcpServer: config.configurable.tools[r.name]?.mcpServer ?? null,
  }));
  steps.forEach((s) => config?.configurable?.onStep?.(s)); // later: agent_step SSE

  return {
    messages: results.map((r) => ({
      role: "tool",
      tool_call_id: r.id,
      content: JSON.stringify(r.output),
    })),
    steps,
    sources: [...sources],
  };
}

// Edge decision after "agent": more tools, or finished?
function routeAfterAgent(state) {
  const last = state.messages.at(-1);
  if (!last?.tool_calls?.length || state.stepCount >= state.maxSteps)
    return "end";
  return "tools";
}

export const webAgentGraph = new StateGraph(WebAgentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolsNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAfterAgent, { tools: "tools", end: END })
  .addEdge("tools", "agent")
  // A web agent finishes in seconds and is never paused, so it saves no checkpoints.
  // Without this it inherits CRAG's checkpointer, and parallel agents would share one slot.
  .compile({ checkpointer: false });

// Web tools come from the Tavily MCP server; the built-in tools are the fallback.
async function loadWebTools() {
  try {
    return await getMcpTools("tavily");
  } catch (error) {
    console.error(
      "[Web agent] Tavily MCP unavailable, using built-in tools:",
      error.message,
    );
    return webTools;
  }
}

export async function runWebAgentGraph(
  task,
  { maxSteps = MAX_STEPS, onStep } = {},
) {
  const tools = await loadWebTools();

  const today = new Date().toISOString().slice(0, 10);
  const final = await webAgentGraph.invoke(
    {
      maxSteps,
      messages: [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\nToday's date: ${today}.`,
        },
        { role: "user", content: task },
      ],
    },
    { configurable: { onStep, tools } },
  );

  return {
    answer: final.answer,
    sources: final.sources,
    steps: final.steps,
    stopReason: final.stopReason || "step_limit",
  };
}
