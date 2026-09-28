import OpenAI from "openai";
import { CohereClient } from "cohere-ai";
import "dotenv/config";

// Available on Gemini's API free tier, subject to the project's quotas.
const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

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
 summary: "openai/gpt-oss-20b",      // summary: "gemini-3.5-flash-lite",
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
  throw new Error(
    active === "gemini"
      ? "Missing Gemini API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY)."
      : `Missing API key for AI provider "${active}"`,
  );
}

export const AI_PROVIDER = active;
export const MODELS = provider.models;

export const llm = new OpenAI({
  baseURL: provider.baseURL,
  apiKey: provider.apiKey,
});

export const summaryLlm = new OpenAI({
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  apiKey: process.env.GEMINI_API_KEY,
});

// export const summaryLlm = new OpenAI({
//   baseURL: "https://api.inceptionlabs.ai/v1",
//   apiKey: process.env.INCEPTION_API_KEY,
// });

if (active === "gemini") {
  const createCompletion = llm.chat.completions.create.bind(
    llm.chat.completions,
  );
  llm.chat.completions.create = (params, options) => {
    // Existing services send temperature: 0. Gemini 3 recommends its default.
    // Copy the payload so callers' request objects remain unchanged.
    const request = { ...params };
    if (request.model?.startsWith("gemini-3")) {
      delete request.temperature;
      delete request.top_p;
    }
    return createCompletion(request, options);
  };
}

export const RERANK_MODEL = "rerank-english-v3.0";

export const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});
