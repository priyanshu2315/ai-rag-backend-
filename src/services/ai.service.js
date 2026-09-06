import fs from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { pipeline } from "@xenova/transformers";
import "dotenv/config";
import mammoth from "mammoth";
import { supabase } from "../config/supabase.js";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import * as cheerio from "cheerio"; // <-- 1. Import Cheerio at the top of your file
import { traceable } from "langsmith/traceable";
import { LlamaParseReader } from "llama-cloud-services";
import { llm, cohere, MODELS, RERANK_MODEL } from "../config/ai.js";

// 1. Extract text from the physical file
// export const extractTextFromPDF = async (filepath) => {
//   const dataBuffer = fs.readFileSync(filepath);
//   const parser = new PDFParse({
//     data: dataBuffer,
//   });
//   const data = await parser.getText();
//   await parser.destroy();

//   return data.text; // Returns all the text from the PDF
// };

export const rerankChunks = async (query, chunks, topN = 3) => {
  // Cohere expects an array of strings (the text of our chunks)
  const documents = chunks.map((chunk) => chunk.text);
  console.log(documents, "documents");
  const response = await cohere.rerank({
    model: RERANK_MODEL,
    query: query,
    documents: documents,
    topN: topN, // We only want the top 3 back
  });
  console.log(response.results, "results");
  const rerankedChunks = response.results.map((result) => chunks[result.index]);

  return rerankedChunks;
};

export const extractDocPages = async (filepath, mimetype) => {
  const { data, error } = await supabase.storage
    .from("documents")
    .download(filepath);

  if (error) {
    throw new Error(`Failed to download from Supabase: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const supportedVisionTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
    "image/jpeg",
    "image/png",
    "image/webp",
  ];

  // ==========================================
  // 1. PDFs, Word Docs, AND Images (LlamaParse Vision)
  // ==========================================
  if (supportedVisionTypes.includes(mimetype)) {
    console.log(`👁️ Extracting ${mimetype} using LlamaParse Premium Vision...`);

    const reader = new LlamaParseReader({
      resultType: "markdown",
      apiKey: process.env.LLAMA_CLOUD_API_KEY,
      premiumMode: true, // Handles OCR and Vision for images AND documents automatically
      parsingInstruction: `
        You are a universal document extraction AI. Extract all content into clean, semantic Markdown.
        
        1. TEXT & HIERARCHY: Preserve all headings, paragraphs, lists, footnotes, and fine print exactly as they appear. Do not summarize or omit text.
        2. EMBEDDED SCANS & EXHIBITS: If a page contains a scanned image of another document (e.g., an invoice, receipt, or specimen exhibit), you MUST transcribe all text, addresses, and line items INSIDE that image as if it were standard page text. Do not skip it.
        3. TABULAR DATA: Convert all grids, financial statements, and borderless tabular layouts into standard Markdown tables with column headers.
        4. DATA VISUALIZATIONS: If you encounter quantitative charts (bar, line, pie, scatter), extract the underlying axes, labels, and exact coordinate data points into a Markdown table. Do not write a generic summary of the trend.
        5. DIAGRAMS & SCHEMATICS: For flowcharts, organizational hierarchies, process maps, or spatial plans, transcribe the structural relationships, flow directions, and textual labels into hierarchical bullet points.
      `,
    });

    // LlamaParse processes the buffer and returns Markdown
    const documents = await reader.loadDataAsContent(buffer);
    return documents;
    // const markdownText = documents.map((doc) => doc.text).join("\n\n");

    // return markdownText;
  }

  // ==========================================
  // 2. Plain Text / Markdown (.txt, .md)
  // ==========================================
  if (mimetype === "text/plain" || mimetype === "text/markdown") {
    return [{ text: buffer.toString("utf-8") }];
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
};
// export const extractText = async (filepath, mimetype) => {
//   // const buffer = await fs.readFile(filepath);
//   const { data, error } = await supabase.storage
//     .from("documents")
//     .download(filepath);
//   if (error)
//     throw new Error(`Failed to download from Supabase: ${error.message}`);
//   // 2. Convert the downloaded Blob into a Node.js Buffer
//   const arrayBuffer = await data.arrayBuffer();
//   const buffer = Buffer.from(arrayBuffer);

//   // 1. PDF Files

//   if (mimetype === "application/pdf") {
//     const parser = new PDFParse({
//       data: buffer,
//     });
//     const data = await parser.getText();
//     return data.text;
//   }
//   // 2. Word Documents (.docx)
//   if (
//     mimetype ===
//     "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
//   ) {
//     const { value: html } = await mammoth.convertToHtml({ buffer: buffer });

//     // Load the raw HTML into Cheerio so we can manipulate it reliably
//     const $ = cheerio.load(html);

//     // 1. Force the first row of EVERY table to be headers (<th> instead of <td>)
//     $("table").each((_, table) => {
//       $(table)
//         .find("tr")
//         .first() // Grab only the first row
//         .find("td")
//         .each((_, td) => {
//           // Copy the contents of the <td> into a new <th>
//           const th = $("<th>").html($(td).html());
//           $(td).replaceWith(th);
//         });
//     });

//     // 2. Remove all <p> tags inside tables (unwraps them so text is inline)
//     $("table p").each((_, p) => {
//       $(p).replaceWith($(p).contents());
//     });

//     // Extract the perfectly sanitized HTML
//     const sanitizedHtml = $.html();
//     console.log("Sanitized HTML:", sanitizedHtml); // You will now see clean <th> tags and no <p> tags!

//     // 3. Convert to Markdown
//     const turndownService = new TurndownService();
//     turndownService.use(gfm);

//     const markdownText = turndownService.turndown(sanitizedHtml);
//     console.log("Markdown Text:", markdownText);

//     return markdownText;
//   }
//   // 3. Plain Text / Markdown (.txt, .md)
//   if (mimetype === "text/plain" || mimetype === "text/markdown") {
//     return buffer.toString("utf-8");
//   }

//   throw new Error(`Unsupported file type: ${mimetype}`);
// };

// 2. Generate Vectors
// We define this outside the function so the AI model only loads into memory once
let extractorPipeline;

export const getEmbedding = async (text) => {
  if (!extractorPipeline) {
    // This downloads a small (80MB) AI model perfectly tuned for vector search
    extractorPipeline = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }

  const output = await extractorPipeline(text, {
    pooling: "mean",
    normalize: true,
  });

  // The output is a Float32Array. We convert it to a standard JavaScript Array.
  // This will be exactly 384 numbers long.
  return Array.from(output.data);
};

// export const askOllama = async (prompt) => {
//   // Ollama runs on port 11434 by default

//   const response = await fetch("http://localhost:11434/api/generate", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       //   model: "qwen2.5:1.5b", // Or whichever model you downloaded via 'ollama run'
//       model: "phi3:mini", // Or whichever model you downloaded via 'ollama run'
//       prompt: prompt,
//       stream: false, // Wait for the full response before returning
//     }),
//   });

//   const data = await response.json();
//   return data.response;
// };

// export const askOllama = async (prompt) => {
//   const response = await fetch(
//     `${process.env.OLLAMA_BASE_URL}/api/generate`,
//     {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         model: "phi3:mini",
//         prompt,
//         stream: false,
//       }),
//     }
//   );

//   if (!response.ok) {
//     throw new Error(
//       `Ollama request failed: ${response.status} ${response.statusText}`
//     );
//   }

//   const data = await response.json();

//   return data.response;
// };

export const searchToolDefinition = {
  type: "function",
  function: {
    name: "search_corporate_database",
    description:
      "Search the company vector database for internal policies, rules, and documents. Use this whenever you need factual information to answer a user's question.",
    parameters: {
      type: "object",
      properties: {
        search_query: {
          type: "string",
          description:
            "The highly optimized, standalone search query (e.g., 'What is the late fee policy for Supplier A?')",
        },
        page_number: {
          type: ["integer", "null"],
          description:
            "The exact page number if the user asks for a specific page (e.g., 3). Use null for general semantic searches.",
        },
      },
      required: ["search_query"],
    },
  },
};
export const summaryToolDefinition = {
  type: "function",
  function: {
    name: "get_document_summary",
    description:
      "Retrieve the pre-computed executive summary of the ENTIRE document. Use this when the user asks for a general summary, outline, or overview of the whole file.",
    parameters: {
      type: "object",
      properties: {}, // No arguments needed, documentId is passed via context
      required: [], // Explicitly tell Groq no parameters are required
    },
  },
};

export const getAgentResponse = traceable(
  async (messages) => {
    const systemPrompt = {
      role: "system",
      content:
        "You are an AI document assistant. A document is currently active and loaded in the user's view. If the user asks for a summary, immediately use the get_document_summary tool. Do NOT ask the user to specify which document they mean.",
    };

    const messagesWithContext = [systemPrompt, ...messages];

    return await llm.chat.completions.create({
      messages: messagesWithContext,
      model: MODELS.agent,
      temperature: 0,
      tools: [searchToolDefinition, summaryToolDefinition],
      tool_choice: "auto", // Allows the AI to decide if it needs to search or just reply
    });
  },
  { name: "LLM_Agent_Reasoning_Step" },
);

export const askLLM = async (prompt, onToken) => {
  const stream = await llm.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: MODELS.chat,
    temperature: 0, // ADD THIS: Forces strict, deterministic answers
    stream: true, // This tells Groq to stream the response
  });
  for await (const chunk of stream) {
    // Extract the exact word/token generated
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      onToken(content); // Fire the callback immediately
    }
  }
  // return completion.choices[0]?.message?.content;
};

export const classifyIntent = async (userMessage) => {
  const prompt = `Classify this message into one of three intents:
1. "GREETING" (Hello, thanks, small talk)
2. "GLOBAL_SUMMARIZE" (Asking for an overview of the ENTIRE document. e.g., "Summarize this document", "What is this file about?")
3. "SEARCH" (Asking a factual question OR asking to summarize a SPECIFIC part/topic. e.g., "Summarize the Q2 data", "Summarize the SLA policy", "What happened in April?")

Output ONLY valid JSON: {"intent": "GREETING" | "GLOBAL_SUMMARIZE" | "SEARCH"}

Message: "${userMessage}"`;

  const response = await llm.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: MODELS.fast,
    temperature: 0,
    response_format: { type: "json_object" },
  });
  return JSON.parse(response.choices[0].message.content).intent;
};
export const rewriteQuery = async (userMessage, chatHistoryText) => {
  if (!chatHistoryText) return userMessage;

  const prompt = `Use the chat history to rewrite the latest question into a standalone database search query. Resolve pronouns (it, they). Do not answer the question.
History:
${chatHistoryText}
Question: ${userMessage}
Standalone Query:`;

  const response = await llm.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: MODELS.fast,
    temperature: 0,
  });
  return response.choices[0].message.content.trim();
};
