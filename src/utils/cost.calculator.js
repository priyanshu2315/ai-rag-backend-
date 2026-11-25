const USD_TO_INR = 96.78;

// Pricing in USD per 1 Million tokens: { input, output, cacheRead? }
// cacheRead is the price of cached prompt tokens; without it they cost the input price.
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

  // OpenRouter models (prices checked 9 Nov 2026)
  "qwen/qwen3.8-flash": { input: 0.15, output: 0.47 },
  // AI Router models (prices updated 25 Nov 2026)
  "alibaba/qwen3.8-omni-flash": { input: 0.15, output: 0.47, cacheRead: 0.02 },
  "deepseek/deepseek-v4-flash": { input: 0.13, output: 0.26, cacheRead: 0.03 },
  "alibaba/qwen3.7-flash": { input: 0.03, output: 0.13, cacheRead: 0.01 },

  // Default fallback
  default: { input: 0.15, output: 0.25 },
};

export function calculateCostINR(modelName, usage) {
  const promptTokens = usage?.prompt_tokens ?? usage?.promptTokens ?? 0;
  const completionTokens =
    usage?.completion_tokens ?? usage?.completionTokens ?? 0;
  const totalTokens =
    usage?.total_tokens ??
    usage?.totalTokens ??
    promptTokens + completionTokens;

  // Cached tokens are part of promptTokens (OpenAI-compatible usage format)
  const cachedTokens = Math.min(
    usage?.prompt_tokens_details?.cached_tokens ?? 0,
    promptTokens,
  );

  const rates = MODEL_PRICING_USD[modelName] || MODEL_PRICING_USD.default;
  const cacheRate = rates.cacheRead ?? rates.input;
  const costUSD =
    ((promptTokens - cachedTokens) * rates.input +
      cachedTokens * cacheRate +
      completionTokens * rates.output) /
    1_000_000;
  const costINR = costUSD * USD_TO_INR;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cachedTokens,
    costUSD: Number(costUSD.toFixed(6)),
    costINR: Number(costINR.toFixed(4)),
    formattedINR: `₹${costINR < 0.01 ? costINR.toFixed(4) : costINR.toFixed(2)}`,
  };
}
