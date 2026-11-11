import OpenAI from "openai";
import { CohereClient } from "cohere-ai";
import "dotenv/config";

// Re-export cost calculator helper for CRAG and metrics
export { calculateCostINR } from "../utils/cost.calculator.js";

export const PROVIDERS = {
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI_API_KEY,
    models: {
      extraction: "gemini-3.5-flash-lite",
      summary: "gemini-3.5-flash-lite",
      chat: "gemini-3.5-flash-lite",
      agent: "gemini-3.5-flash-lite",
      fast: "gemini-3.5-flash-lite",
    },
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY || process.env.GROK_API_KEY,
    models: {
      extraction: "llama-3.2-11b-vision-preview",
      summary: "openai/gpt-oss-20b",
      chat: "openai/gpt-oss-120b",
      agent: "openai/gpt-oss-120b",
      fast: "openai/gpt-oss-20b",
    },
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER || process.env.OPENROUTER_API_KEY,
    models: {
      // Reads page images and supports json_schema output (checked 9 Nov 2026).
      extraction: "qwen/qwen3.8-flash",
      summary: "openai/gpt-oss-20b",
      chat: "openai/gpt-oss-120b",
      agent: "openai/gpt-oss-120b",
      fast: "openai/gpt-oss-20b",
    },
  },
  opencode: {
    baseURL: "https://api.b.ai/v1",
    apiKey: process.env.OPENCODE_API_KEY,
    models: {
      extraction: "qwen3.8-flash",
      summary: "glm-5.3-flash",
      chat: "qwen3.8-flash",
      agent: "qwen3.8-flash",
      fast: "glm-5.3-flash",
    },
  },
  airouter: {
    baseURL: process.env.AI_ROUTER_BASE_URL || "https://api.airouter.in/v1",
    apiKey: process.env.AI_ROUTER_API_KEY,
    models: {
      // Qwen 3.8 Flash family; reads page images and supports json_schema (smoke-tested 9 Nov 2026).
      extraction: "alibaba/qwen3.8-omni-flash",
      summary: "deepseek/deepseek-v4-flash",
      chat: "deepseek/deepseek-v4-flash",
      agent: "deepseek/deepseek-v4-flash",
      fast: "alibaba/qwen3.7-flash",
    },
  },
};

/**
 * 2. Task Provider Mapping
 * Single source of truth: configure which provider handles each task right here.
 */
export const DEFAULT_TASK_PROVIDERS = {
  extraction: "airouter", // Qwen 3.8 omni-flash via AI Router. OpenRouter qwen/qwen3.8-flash also works but its free-tier credit ran out (402) on 9 Nov after 18 documents; Gemini flash-lite until 9 Nov
  summary: "airouter", // AI Router (large context, avoids Groq's 8k TPM limits)
  chat: "airouter", // AI Router for high-quality generation
  agent: "airouter", // AI Router for CRAG deep reasoning & generation
  fast: "groq", // Groq for fast grading, rewrite, intent
};

export const AI_PROVIDER = "mixed";
const clients = new Map();

/**
 * Resolves the client, model, and providerName for a given task.
 * Directly controlled by DEFAULT_TASK_PROVIDERS and PROVIDERS.
 */
export function getAI(task) {
  const providerName = DEFAULT_TASK_PROVIDERS[task];
  if (!providerName) {
    throw new Error(
      `Unknown AI task: "${task}". Valid tasks: ${Object.keys(DEFAULT_TASK_PROVIDERS).join(", ")}`,
    );
  }

  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`Unknown AI provider "${providerName}" for task "${task}"`);
  }
  if (!provider.apiKey) {
    throw new Error(`Missing API key for provider "${providerName}"`);
  }

  const model = provider.models[task];
  if (!model) {
    throw new Error(
      `No "${task}" model configured for provider "${providerName}"`,
    );
  }

  // Lazy initialize OpenAI client per provider
  if (!clients.has(providerName)) {
    clients.set(
      providerName,
      new OpenAI({
        baseURL: provider.baseURL,
        apiKey: provider.apiKey,
      }),
    );
  }

  return { client: clients.get(providerName), model, providerName };
}

/**
 * Execute chat completion for a specific task using its resolved provider and model.
 */
// requestOptions are OpenAI SDK request settings such as { timeout, maxRetries }.
export function chatCompletion(task, options, requestOptions) {
  const { client, model } = getAI(task);
  return client.chat.completions.create({ ...options, model }, requestOptions);
}

export const RERANK_MODEL = "rerank-english-v3.0";

export const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});
