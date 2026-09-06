import OpenAI from "openai";
import { CohereClient } from "cohere-ai";
import "dotenv/config";

const PROVIDERS = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROK_API_KEY,
    models: {
      agent: "openai/gpt-oss-120b",
      chat: "openai/gpt-oss-120b",
      fast: "openai/gpt-oss-20b",
      summary: "openai/gpt-oss-20b",
    },
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER,
    models: {
      agent: "openai/gpt-oss-120b",
      chat: "openai/gpt-oss-120b",
      fast: "openai/gpt-oss-20b",
      summary: "openai/gpt-oss-20b",
    },
  },
};

const active = process.env.AI_PROVIDER || "groq";
const provider = PROVIDERS[active];

if (!provider) {
  throw new Error(
    `Unknown AI_PROVIDER "${active}". Use one of: ${Object.keys(PROVIDERS).join(", ")}`,
  );
}

if (!provider.apiKey) {
  throw new Error(`Missing API key for AI provider "${active}"`);
}

export const AI_PROVIDER = active;
export const MODELS = provider.models;

export const llm = new OpenAI({
  baseURL: provider.baseURL,
  apiKey: provider.apiKey,
});

export const RERANK_MODEL = "rerank-english-v3.0";

export const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});
