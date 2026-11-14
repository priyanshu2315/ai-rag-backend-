// src/agents/web/web.tools.js
// Web tools for the web research agent: web_search and read_page (Tavily).
import "dotenv/config";

const TAVILY_URL = "https://api.tavily.com";
const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 600; // per search result
const MAX_PAGE_CHARS = 6000; // per page read; keeps model tokens low
const TIMEOUT_MS = 20_000;

// One place that calls Tavily with plain fetch (no new package).
async function callTavily(path, body) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("Missing TAVILY_API_KEY");

  const res = await fetch(`${TAVILY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Tavily ${path} failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return res.json();
}

// Collapse whitespace and cut long text.
function cut(text, max) {
  const clean = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

// ---------- run functions (your code runs these) ----------

export async function webSearch({ query }) {
  const data = await callTavily("/search", {
    query,
    max_results: MAX_RESULTS,
    search_depth: "basic",
  });

  return {
    query,
    results: (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      text: cut(r.content, MAX_SNIPPET_CHARS),
      publishedDate: r.published_date ?? null,
    })),
  };
}

export async function readPage({ url }) {
  const data = await callTavily("/extract", { urls: [url] });
  const page = data.results?.[0];
  if (!page) return { url, error: "Could not read this page." };

  return { url, text: cut(page.raw_content, MAX_PAGE_CHARS) };
}

// ---------- definitions (the model reads these) ----------

export const webSearchDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the public web. Returns the top 5 results with title, URL and a short text snippet. Use it for live or public facts: exchange rates, prices, news, laws, public facts about companies.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A short standalone search query, e.g. 'EUR to USD exchange rate today'",
        },
      },
      required: ["query"],
    },
  },
};

export const readPageDefinition = {
  type: "function",
  function: {
    name: "read_page",
    description:
      "Read the main text of one web page. Use it only when a search snippet does not contain the exact fact you need. Pass a URL from a web_search result.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full page URL from a search result",
        },
      },
      required: ["url"],
    },
  },
};

// ---------- registry: tool name -> { definition, run } ----------
// The agent loop uses this to (1) send definitions to the model
// and (2) find the function when the model asks for a tool by name.
export const webTools = {
  web_search: { definition: webSearchDefinition, run: webSearch },
  read_page: { definition: readPageDefinition, run: readPage },
};
