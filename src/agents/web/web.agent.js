// src/agents/web/web.agent.js
// Web research agent: the model picks tools (web_search, read_page) in a loop
// until it answers or reaches MAX_STEPS. No LangGraph yet (plain loop).
import { chatCompletion } from "../../config/ai.js";
import { webTools } from "./web.tools.js";

export const MAX_STEPS = 4;

export const SYSTEM_PROMPT = `You are a web research agent. Find the facts the user asks for on the public web.
Rules:
- Use web_search first. Use read_page only when the snippets do not contain the exact fact.
- Prefer official or well-known sources.
- When you have the answer, reply briefly: each fact, its source URL, and the date the source gives.
- If you cannot find a fact, say so. Do not guess.`;

// Run one tool the model asked for. Errors go back to the model as a result,
// so it can try something else instead of crashing the loop.
export async function runToolCall(call) {
  const name = call.function?.name;
  const tool = webTools[name];

  let args = {};
  try {
    args = JSON.parse(call.function?.arguments || "{}");
  } catch {
    return {
      id: call.id,
      name,
      args,
      output: { error: "Arguments were not valid JSON." },
    };
  }

  if (!tool) {
    return {
      id: call.id,
      name,
      args,
      output: { error: `Unknown tool: ${name}` },
    };
  }

  try {
    return { id: call.id, name, args, output: await tool.run(args) };
  } catch (error) {
    return { id: call.id, name, args, output: { error: error.message } };
  }
}

// Remember every URL the agent saw, so the answer can show its sources.
export function collectSources(output, sources) {
  if (output?.url && !output.error) sources.add(output.url);
  for (const r of output?.results ?? []) if (r.url) sources.add(r.url);
}

export async function runWebAgent(task, { maxSteps = MAX_STEPS, onStep } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const messages = [
    { role: "system", content: `${SYSTEM_PROMPT}\nToday's date: ${today}.` },
    { role: "user", content: task },
  ];
  const toolDefinitions = Object.values(webTools).map((t) => t.definition);
  const steps = [];
  const sources = new Set();

  for (let step = 1; step <= maxSteps; step++) {
    const lastStep = step === maxSteps;

    // On the last step: no tools, the model must answer with what it has.
    if (lastStep) {
      messages.push({
        role: "user",
        content:
          "Step limit reached. Answer now using only what you found so far.",
      });
    }

    // 1. Ask the model: answer, or which tool next?
    const response = await chatCompletion("agent", {
      messages,
      temperature: 0,
      ...(lastStep ? {} : { tools: toolDefinitions, tool_choice: "auto" }),
    });
    const message = response.choices[0].message;
    console.log(message, `message ${step}`);
    const toolCalls = message.tool_calls ?? [];

    // 2. No tool calls -> the model is done.
    if (toolCalls.length === 0) {
      console.log(message.content, `message content ${step}`);
      return {
        answer: message.content?.trim() || "",
        sources: [...sources],
        steps,
        stopReason: lastStep ? "step_limit" : "done",
      };
    }

    // 3. Keep the model's tool request in the history (only the fields we need).
    messages.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls,
    });

    // 4. Run the requested tools (in parallel) and add each result.
    const results = await Promise.all(toolCalls.map(runToolCall));
    console.log(results[0], `results ${step}`);
    for (const r of results) {
      messages.push({
        role: "tool",
        tool_call_id: r.id,
        content: JSON.stringify(r.output),
      });
      const record = { step, tool: r.name, args: r.args, ok: !r.output.error };
      steps.push(record);
      onStep?.(record); // later: send an agent_step SSE event
      collectSources(r.output, sources);
    }
  }

  // Safety net: should not happen, because the last step has no tools.
  return { answer: "", sources: [...sources], steps, stopReason: "step_limit" };
}
