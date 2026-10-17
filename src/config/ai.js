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
      extraction: "gemini-3.5-flash-lite",
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
  nvidia: {
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKey: process.env.NVIDIA_API_KEY,
    models: {
      agent: "deepseek-ai/deepseek-v4.1-flash",
      chat: "deepseek-ai/deepseek-v4.1-flash",
      fast: "nvidia/nemotron-3.5-lightning-30b-a3b",
      summary: "nvidia/nemotron-3.5-lightning-30b-a3b",

      analysis: "nvidia/nemotron-3-super-120b-a12b",
      // Vision model: reads page images in batches with the same prompt as Gemini.
      extraction: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    },
    // Keep Nemotron helpers in direct-answer mode; DeepSeek uses its own defaults.
    requestOptions: {
      fast: { chat_template_kwargs: { enable_thinking: false } },
      summary: { chat_template_kwargs: { enable_thinking: false } },
      extraction: {
        max_tokens: 16384,
        chat_template_kwargs: { enable_thinking: false },
      },
      // With thinking on, one profile call took ~70 s and ~2,800 output tokens; off: 6 s.
      analysis: { chat_template_kwargs: { enable_thinking: false } },
    },
    // One page per request (several pages per request let the model copy text from
    // the next page), four requests at a time.
    extractionBatching: { batchSize: 1, concurrency: 4 },
  },
};
const DEFAULT_TASK_PROVIDERS = {
  agent: "groq",
  chat: "groq",
  fast: "groq",
  summary: "openrouter",
  extraction: "gemini",
};

// The environment selects the provider for non-extraction tasks.
export const AI_PROVIDER = process.env.AI_PROVIDER || "mixed";
const clients = new Map();

export function getAI(task) {
  if (!(task in DEFAULT_TASK_PROVIDERS)) {
    throw new Error(`Unknown AI task: ${task}`);
  }

  // Document extraction always uses Gemini 3.5 Flash Lite.
  let providerName = AI_PROVIDER;
  if (task === "extraction") providerName = "gemini";
  else if (AI_PROVIDER === "mixed")
    providerName =
      process.env[`AI_${task.toUpperCase()}_PROVIDER`] ||
      DEFAULT_TASK_PROVIDERS[task];

  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new Error(`Unknown AI provider: ${providerName}`);
  }
  if (!provider.apiKey) {
    throw new Error(`Missing API key for ${providerName}`);
  }

  // Ignore task model overrides when AI_PROVIDER forces one provider.
  // This prevents an OpenRouter model ID being sent to OpenCode.
  let model = provider.models[task];
  if (task !== "extraction" && AI_PROVIDER === "mixed")
    model = process.env[`AI_${task.toUpperCase()}_MODEL`] || model;

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
  const { client, model, providerName } = getAI(task);
  const taskOptions = PROVIDERS[providerName].requestOptions?.[task];
  return client.chat.completions.create({ ...taskOptions, ...options, model });
}

export const RERANK_MODEL = "rerank-english-v3.0";

export const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

const USD_TO_INR = 96.78;

// Pricing in USD per 1 Million tokens: { input: $/1M, output: $/1M }
const MODEL_PRICING_USD = {
  // Groq models
  "openai/gpt-oss-120b": { input: 0.59, output: 0.79 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "openai/gpt-oss-20b": { input: 0.05, output: 0.08 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },

  // Gemini models
  "gemini-3.5-flash-lite": { input: 0.075, output: 0.3 },
  "gemini-2.0-flash": { input: 0.075, output: 0.3 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },

  // Default fallback
  default: { input: 0.15, output: 0.3 },
};

export function calculateCostINR(modelName, usage) {
  const promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? 0;
  const completionTokens =
    usage?.completion_tokens ?? usage?.completionTokens ?? 0;
  const totalTokens =
    usage?.total_tokens ??
    usage?.totalTokens ??
    promptTokens + completionTokens;

  const rates = MODEL_PRICING_USD[modelName] || MODEL_PRICING_USD.default;
  const costUSD =
    (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000;
  const costINR = costUSD * USD_TO_INR;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    costUSD: Number(costUSD.toFixed(6)),
    costINR: Number(costINR.toFixed(4)),
    formattedINR: `₹${costINR < 0.01 ? costINR.toFixed(4) : costINR.toFixed(2)}`,
  };
}
