import OpenAI from "openai";
import { CohereClient } from "cohere-ai";
import "dotenv/config";

// Available on Gemini's API free tier, subject to the project's quotas.

const PROVIDERS = {
  gemini: {
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI_API_KEY,
    models: {
      agent: "gemini-3.5-flash-lite",
      chat: "gemini-3.5-flash-lite",
      fast: "gemini-3.5-flash-lite",
      summary: "gemini-3.5-flash-lite",
      // summary: "gemini-3.5-flash-lite",
    },
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROK_API_KEY,
    models: {
      agent: "openai/gpt-oss-120b",
      chat: "openai/gpt-oss-120b",
      fast: "openai/gpt-oss-20b",
      summary: "openai/gpt-oss-20b",
      // summary: "gemini-3.5-flash-lite",
    },
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER,
    models: {
      agent: "openai/gpt-oss-120b",
      chat: "openai/gpt-oss-120b",
      fast: "openai/gpt-oss-20b",
      summary: "openai/gpt-oss-20b", // summary: "gemini-3.5-flash-lite",
    },
  },
  opencode: {
    baseURL: "https://api.b.ai/v1",
    apiKey: process.env.OPENCODE_API_KEY,
    models: {
      agent: "qwen3.8-flash",
      chat: "qwen3.8-flash",
      fast: "glm-5.3-flash",
      summary: "glm-5.3-flash",
      // summary: "gemini-3.5-flash-lite",
    },
  },
};
const DEFAULT_TASK_PROVIDERS = {
  agent: "groq",
  chat: "groq",
  fast: "groq",
  summary: "openrouter",
};

export const AI_PROVIDER = process.env.AI_PROVIDER || "mixed";
const clients = new Map();

export function getAI(task) {
  if (!(task in DEFAULT_TASK_PROVIDERS)) {
    throw new Error(`Unknown AI task: ${task}`);
  }

  // A named AI_PROVIDER overrides every task. "mixed" enables task routing.
  const providerName =
    AI_PROVIDER === "mixed"
      ? process.env[`AI_${task.toUpperCase()}_PROVIDER`] ||
        DEFAULT_TASK_PROVIDERS[task]
      : AI_PROVIDER;

  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerName}`);
  }
  if (!provider.apiKey) {
    throw new Error(`Missing API key for ${providerName}`);
  }

  // Ignore task model overrides when AI_PROVIDER forces one provider.
  // This prevents an OpenRouter model ID being sent to OpenCode.
  const model =
    AI_PROVIDER === "mixed"
      ? process.env[`AI_${task.toUpperCase()}_MODEL`] || provider.models[task]
      : provider.models[task];

  if (!model) {
    throw new Error(`No ${task} model configured for ${providerName}`);
  }

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

export function chatCompletion(task, options) {
  const { client, model } = getAI(task);
  return client.chat.completions.create({ ...options, model });
}

export const RERANK_MODEL = "rerank-english-v3.0";

export const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});
