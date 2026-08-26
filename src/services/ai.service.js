import fs from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { pipeline } from "@xenova/transformers";
import Groq from "groq-sdk";
import "dotenv/config";
import mammoth from "mammoth";
import { supabase } from "../config/supabase.js";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import * as cheerio from "cheerio"; // <-- 1. Import Cheerio at the top of your file

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

export const extractText = async (filepath, mimetype) => {
  // const buffer = await fs.readFile(filepath);
  const { data, error } = await supabase.storage
    .from("documents")
    .download(filepath);
  if (error)
    throw new Error(`Failed to download from Supabase: ${error.message}`);
  // 2. Convert the downloaded Blob into a Node.js Buffer
  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // 1. PDF Files

  if (mimetype === "application/pdf") {
    const parser = new PDFParse({
      data: buffer,
    });
    const data = await parser.getText();
    return data.text;
  }
  // 2. Word Documents (.docx)
  if (
    mimetype ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const { value: html } = await mammoth.convertToHtml({ buffer: buffer });

    // Load the raw HTML into Cheerio so we can manipulate it reliably
    const $ = cheerio.load(html);

    // 1. Force the first row of EVERY table to be headers (<th> instead of <td>)
    $("table").each((_, table) => {
      $(table)
        .find("tr")
        .first() // Grab only the first row
        .find("td")
        .each((_, td) => {
          // Copy the contents of the <td> into a new <th>
          const th = $("<th>").html($(td).html());
          $(td).replaceWith(th);
        });
    });

    // 2. Remove all <p> tags inside tables (unwraps them so text is inline)
    $("table p").each((_, p) => {
      $(p).replaceWith($(p).contents());
    });

    // Extract the perfectly sanitized HTML
    const sanitizedHtml = $.html();
    console.log("Sanitized HTML:", sanitizedHtml); // You will now see clean <th> tags and no <p> tags!

    // 3. Convert to Markdown
    const turndownService = new TurndownService();
    turndownService.use(gfm);

    const markdownText = turndownService.turndown(sanitizedHtml);
    console.log("Markdown Text:", markdownText);

    return markdownText;
  }
  // 3. Plain Text / Markdown (.txt, .md)
  if (mimetype === "text/plain" || mimetype === "text/markdown") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
};

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

let groq = new Groq({
  apiKey: process.env.GROK_API_KEY,
});

const models = await groq.models.list();

for (const model of models.data) {
  console.log(model.id);
}
export const askLLM = async (prompt, onToken) => {
  const stream = await groq.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "openai/gpt-oss-120b",
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
