import { Worker } from "bullmq";
import Redis from "ioredis";
import prisma from "../config/db.js";
import * as aiService from "../services/ai.service.js";
import { randomUUID } from "crypto";
import "dotenv/config";
import { encode } from "gpt-tokenizer";
import {
  MarkdownTextSplitter,
  RecursiveCharacterTextSplitter,
} from "@langchain/textsplitters";
import { llm, MODELS } from "../config/ai.js";

const redisConnection = new Redis(process.env.REDIS_URL, {
  // host: "localhost",
  // port: 6379,
  maxRetriesPerRequest: null,
  tls: {},
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parentSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 200,
});

const childSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 400,
  chunkOverlap: 50,
});

export const startWorker = () => {
  console.log("👷 Background Worker started, listening to Redis...");

  // Listen to the 'document-processing' queue we created earlier
  new Worker(
    "document-processing",
    async (job) => {
      const { documentId, filepath, mimetype } = job.data;
      console.log(`[Job ${job.id}] Started processing document...`);

      try {
        // 1. Read the PDF
        const pages = await aiService.extractDocPages(filepath, mimetype);

        let globalChunkIndex = 0;
        let fullDocumentText = "";

        for (let i = 0; i < pages.length; i++) {
          const pageNumber = i + 1;
          const pageText = pages[i].text || "";
          console.log(pageText, "pageText");
          if (!pageText.trim()) continue;
          fullDocumentText += pageText + "\n\n"; // Keep building this for your summarizer loop

          const parentDocs = await parentSplitter.createDocuments([pageText]);
          console.log(parentDocs, "parentDocs");
          for (const parentDoc of parentDocs) {
            console.log(parentDoc, "parentDoc");
            const parent = await prisma.parentChunk.create({
              data: {
                documentId: documentId,
                text: parentDoc.pageContent,
                metadata: {
                  page_number: pageNumber,
                  chunk_index: globalChunkIndex++,
                },
              },
            });

            const childDocs = await childSplitter.createDocuments([
              parentDoc.pageContent,
            ]);
            for (const childDoc of childDocs) {
              const embeddingArray = await aiService.getEmbedding(
                childDoc.pageContent,
              );
              const embeddingString = `[${embeddingArray.join(",")}]`;
              const childId = randomUUID();
              await prisma.$executeRaw`
    INSERT INTO "ChildChunk" (id, text, "parentId", "documentId", embedding, metadata)
    VALUES (${childId}, ${childDoc.pageContent}, ${parent.id}, ${documentId}, ${embeddingString}::vector, ${JSON.stringify({ page_number: pageNumber })}::jsonb)
    `;
            }
          }
        }

        console.log(`[Job ${job.id}] Vectors saved. Starting summarization...`);

        const MAX_TOKENS_PER_BATCH = 5000;
        const batches = [];
        let currentBatch = "";
        let currentTokenCount = 0;

        const addToBatch = (text) => {
          const textTokens = encode(text).length;

          if (
            currentTokenCount + textTokens > MAX_TOKENS_PER_BATCH &&
            currentBatch.length > 0
          ) {
            batches.push(currentBatch.trim());
            currentBatch = "";
            currentTokenCount = 0;
          }

          currentBatch += text + " ";
          currentTokenCount += textTokens;
        };
        const paragraphs = fullDocumentText
          .split("\n\n")
          .filter((p) => p.trim().length > 40);

        for (const paragraph of paragraphs) {
          const paragraphTokens = encode(paragraph).length;

          if (paragraphTokens <= MAX_TOKENS_PER_BATCH) {
            // Standard Case: Paragraph is safe, add it directly
            addToBatch(paragraph + "\n\n");
          } else {
            // Edge Case 1: Paragraph is massive. Split it into sentences.
            console.log(
              `[Job] Warning: Found massive paragraph (${paragraphTokens} tokens). Splitting by sentence...`,
            );
            const sentences = paragraph.split(/(?<=[.?!])\s+/);

            for (const sentence of sentences) {
              const sentenceTokens = encode(sentence).length;

              if (sentenceTokens <= MAX_TOKENS_PER_BATCH) {
                addToBatch(sentence);
              } else {
                // Edge Case 2: A single sentence is STILL too big (e.g., minified code).
                // Hard-slice by ~12,000 characters (roughly 3,000 - 4,000 tokens).
                console.log(
                  `[Job] Warning: Found massive sentence. Hard-slicing...`,
                );
                const hardSlices = sentence.match(/.{1,12000}/g) || [];
                for (const slice of hardSlices) {
                  addToBatch(slice);
                }
              }
            }
            // Add paragraph break after the giant block is resolved
            currentBatch += "\n\n";
          }
        }
        if (currentBatch.trim().length > 0) {
          batches.push(currentBatch);
        }

        console.log(
          `[Job ${job.id}] Document split into ${batches.length} token-optimized batches.`,
        );

        const batchSummaries = [];
        for (const [index, batchText] of batches.entries()) {
          console.log(
            `[Job ${job.id}] Summarizing batch ${index + 1}/${batches.length}...`,
          );

          const prompt = `Summarize the following document section comprehensively using bullet points:\n\n${batchText}`;

          const response = await llm.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: MODELS.summary,
            temperature: 0,
          });

          batchSummaries.push(response.choices[0].message.content);

          await delay(2500); // Respect Groq rate limits
        }

        let masterSummary = batchSummaries[0];
        if (batches.length > 1) {
          console.log(`[Job ${job.id}] Generating final master summary...`);
          const combinedSummariesText = batchSummaries.join("\n\n---\n\n");

          const masterPrompt = `Synthesize these section summaries into one cohesive, master summary of the entire document:\n\n${combinedSummariesText}`;

          const masterResponse = await llm.chat.completions.create({
            messages: [{ role: "user", content: masterPrompt }],
            model: MODELS.summary,
            temperature: 0,
          });

          masterSummary = masterResponse.choices[0].message.content;
        }

        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: "COMPLETED",
            summary: masterSummary,
          },
        });

        console.log(
          `✅ [Job ${job.id}] Finished saving vectors and master summary!`,
        );
      } catch (error) {
        console.error(`❌ [Job ${job.id}] Failed:`, error);
        await prisma.document.update({
          where: { id: documentId },
          data: { status: "FAILED" },
        });
      }
    },
    { connection: redisConnection },
  );
};

// export const startWorker = () => {
//   console.log("👷 Background Worker started, listening to Redis...");

//   // Listen to the 'document-processing' queue we created earlier
//   new Worker(
//     "document-processing",
//     async (job) => {
//       const { documentId, filepath, mimetype } = job.data;
//       console.log(`[Job ${job.id}] Started processing document...`);

//       try {
//         // 1. Read the PDF
//         const rawText = await aiService.extractText(filepath, mimetype);

//         const splitter = new MarkdownTextSplitter({
//           chunkSize: 1200,
//           chunkOverlap: 200,
//         });
//         const docs = await splitter.createDocuments([rawText]);
//         console.log(docs, "docs from splitter");
//         const paragraphs = docs
//           .map((doc) => doc.pageContent)
//           .filter((p) => p.trim().length > 40);
//         // 2. "Chunking" - split the text by double line breaks (paragraphs)
//         // We filter out chunks that are too short to be useful.

//         console.log(
//           `[Job ${job.id}] Extracted ${paragraphs.length} paragraphs. Generating AI vectors...`,
//         );

//         // We use .entries() to get both the index (parentIndex) and the text (paragraphText)
//         for (const [parentIndex, paragraphText] of paragraphs.entries()) {
//           const parentNum = parentIndex + 1;

//           // 1. Console log for the Parent Chunk
//           console.log(`\n=== Parent ${parentNum} ===`);
//           console.log(`Text: ${paragraphText}\n`);

//           const parent = await prisma.parentChunk.create({
//             data: {
//               documentId: documentId,
//               text: paragraphText,
//             },
//           });

//           // Child Chunking:
//           // If the chunk contains a Markdown table (|), split by row.
//           // Otherwise, split by sentence punctuation (.?!).
//           let sentences = [];
//           if (paragraphText.includes("|")) {
//             sentences = paragraphText
//               .split("\n")
//               .map((s) => s.trim())
//               .filter(
//                 (s) => s.length > 10 && !s.match(/^\|?(\s*:?-+:?\s*\|?)+$/), // Exclude markdown divider rows (e.g. |---|---|)
//               );
//           } else {
//             sentences = paragraphText
//               .split(/(?<=[.?!])\s+/)
//               .map((s) => s.trim())
//               .filter((s) => s.length > 10);
//           }

//           // Fallback if no delimiter matched
//           if (sentences.length === 0) {
//             sentences = [paragraphText.trim()];
//           }

//           // We use .entries() again to track the child index
//           for (const [childIndex, sentenceText] of sentences.entries()) {
//             const childNum = childIndex + 1;

//             // 2. Console log for the Child Chunk (e.g., "Parent 1 -> Parent 1 Child 1")
//             console.log(
//               `Parent ${parentNum} -> Parent ${parentNum} Child ${childNum}: ${sentenceText}`,
//             );

//             const embeddingArray = await aiService.getEmbedding(sentenceText);
//             const embeddingString = `[${embeddingArray.join(",")}]`;
//             const childId = randomUUID();

//             await prisma.$queryRaw`
//     INSERT INTO "ChildChunk" (id, text, "parentId", "documentId", embedding)
//     VALUES (${childId}, ${sentenceText}, ${parent.id}, ${documentId}, ${embeddingString}::vector)
//     `;
//           }
//         }
//         console.log(`[Job ${job.id}] Vectors saved. Starting summarization...`);

//         const MAX_TOKENS_PER_BATCH = 5000;
//         const batches = [];
//         let currentBatch = "";
//         let currentTokenCount = 0;

//         const addToBatch = (text) => {
//           const textTokens = encode(text).length;

//           if (
//             currentTokenCount + textTokens > MAX_TOKENS_PER_BATCH &&
//             currentBatch.length > 0
//           ) {
//             batches.push(currentBatch.trim());
//             currentBatch = "";
//             currentTokenCount = 0;
//           }

//           currentBatch += text + " ";
//           currentTokenCount += textTokens;
//         };

//         for (const paragraph of paragraphs) {
//           const paragraphTokens = encode(paragraph).length;

//           if (paragraphTokens <= MAX_TOKENS_PER_BATCH) {
//             // Standard Case: Paragraph is safe, add it directly
//             addToBatch(paragraph + "\n\n");
//           } else {
//             // Edge Case 1: Paragraph is massive. Split it into sentences.
//             console.log(
//               `[Job] Warning: Found massive paragraph (${paragraphTokens} tokens). Splitting by sentence...`,
//             );
//             const sentences = paragraph.split(/(?<=[.?!])\s+/);

//             for (const sentence of sentences) {
//               const sentenceTokens = encode(sentence).length;

//               if (sentenceTokens <= MAX_TOKENS_PER_BATCH) {
//                 addToBatch(sentence);
//               } else {
//                 // Edge Case 2: A single sentence is STILL too big (e.g., minified code).
//                 // Hard-slice by ~12,000 characters (roughly 3,000 - 4,000 tokens).
//                 console.log(
//                   `[Job] Warning: Found massive sentence. Hard-slicing...`,
//                 );
//                 const hardSlices = sentence.match(/.{1,12000}/g) || [];
//                 for (const slice of hardSlices) {
//                   addToBatch(slice);
//                 }
//               }
//             }
//             // Add paragraph break after the giant block is resolved
//             currentBatch += "\n\n";
//           }
//         }
//         if (currentBatch.trim().length > 0) {
//           batches.push(currentBatch);
//         }

//         console.log(
//           `[Job ${job.id}] Document split into ${batches.length} token-optimized batches.`,
//         );

//         const batchSummaries = [];
//         for (const [index, batchText] of batches.entries()) {
//           console.log(
//             `[Job ${job.id}] Summarizing batch ${index + 1}/${batches.length}...`,
//           );

//           const prompt = `Summarize the following document section comprehensively using bullet points:\n\n${batchText}`;

//           const response = await llm.chat.completions.create({
//             messages: [{ role: "user", content: prompt }],
//             model: MODELS.summary,
//             temperature: 0,
//           });

//           batchSummaries.push(response.choices[0].message.content);

//           await delay(2500); // Respect Groq rate limits
//         }

//         let masterSummary = batchSummaries[0];
//         if (batches.length > 1) {
//           console.log(`[Job ${job.id}] Generating final master summary...`);
//           const combinedSummariesText = batchSummaries.join("\n\n---\n\n");

//           const masterPrompt = `Synthesize these section summaries into one cohesive, master summary of the entire document:\n\n${combinedSummariesText}`;

//           const masterResponse = await llm.chat.completions.create({
//             messages: [{ role: "user", content: masterPrompt }],
//             model: MODELS.summary,
//             temperature: 0,
//           });

//           masterSummary = masterResponse.choices[0].message.content;
//         }

//         await prisma.document.update({
//           where: { id: documentId },
//           data: {
//             status: "COMPLETED",
//             summary: masterSummary,
//           },
//         });

//         console.log(
//           `✅ [Job ${job.id}] Finished saving vectors and master summary!`,
//         );
//       } catch (error) {
//         console.error(`❌ [Job ${job.id}] Failed:`, error);
//         await prisma.document.update({
//           where: { id: documentId },
//           data: { status: "FAILED" },
//         });
//       }
//     },
//     { connection: redisConnection },
//   );
// };
// export const startWorker = () => {
//   console.log("👷 Background Worker started, listening to Redis...");

//   // Listen to the 'document-processing' queue we created earlier
//   new Worker(
//     "document-processing",
//     async (job) => {
//       const { documentId, filepath, mimetype } = job.data;
//       console.log(`[Job ${job.id}] Started processing document...`);

//       try {
//         // 1. Read the PDF
//         const rawText = await aiService.extractText(filepath, mimetype);

//         // 2. "Chunking" - split the text by double line breaks (paragraphs)
//         // We filter out chunks that are too short to be useful.
//         const paragraphs = rawText
//           .split("\n\n")
//           .filter((p) => p.trim().length > 40);

//         console.log(
//           `[Job ${job.id}] Extracted ${paragraphs.length} paragraphs. Generating AI vectors...`,
//         );

//         // for (const paragraphText of paragraphs) {
//         //   const parent = await prisma.parentChunk.create({
//         //     data: {
//         //       documentId: documentId,
//         //       text: paragraphText,
//         //     },
//         //   });

//         //   const sentences = paragraphText
//         //     .split(/(?<=[.?!])\s+/)
//         //     .map((s) => s.trim())
//         //     .filter((s) => s.length > 10);

//         //   for (const sentenceText of sentences) {

//         //     const embeddingArray = await aiService.getEmbedding(sentenceText);
//         //     const embeddingString = `[${embeddingArray.join(",")}]`;
//         //     const childId = randomUUID();

//         //     await prisma.$queryRaw`
//         //     INSERT INTO "ChildChunk" (id, text, "parentId", "documentId", embedding)
//         //     VALUES (${childId}, ${sentenceText}, ${parent.id}, ${documentId}, ${embeddingString}::vector)
//         //     `;
//         //   }
//         // }

//         // We use .entries() to get both the index (parentIndex) and the text (paragraphText)
//         for (const [parentIndex, paragraphText] of paragraphs.entries()) {
//           const parentNum = parentIndex + 1;

//           // 1. Console log for the Parent Chunk
//           console.log(`\n=== Parent ${parentNum} ===`);
//           console.log(`Text: ${paragraphText}\n`);

//           const parent = await prisma.parentChunk.create({
//             data: {
//               documentId: documentId,
//               text: paragraphText,
//             },
//           });

//           const sentences = paragraphText
//             .split(/(?<=[.?!])\s+/)
//             .map((s) => s.trim())
//             .filter((s) => s.length > 10);

//           // We use .entries() again to track the child index
//           for (const [childIndex, sentenceText] of sentences.entries()) {
//             const childNum = childIndex + 1;

//             // 2. Console log for the Child Chunk (e.g., "Parent 1 -> Parent 1 Child 1")
//             console.log(
//               `Parent ${parentNum} -> Parent ${parentNum} Child ${childNum}: ${sentenceText}`,
//             );

//             const embeddingArray = await aiService.getEmbedding(sentenceText);
//             const embeddingString = `[${embeddingArray.join(",")}]`;
//             const childId = randomUUID();

//             await prisma.$queryRaw`
//     INSERT INTO "ChildChunk" (id, text, "parentId", "documentId", embedding)
//     VALUES (${childId}, ${sentenceText}, ${parent.id}, ${documentId}, ${embeddingString}::vector)
//     `;
//           }
//         }

//         await prisma.document.update({
//           where: { id: documentId },
//           data: { status: "COMPLETED" },
//         });

//         // // 3. Loop through each paragraph, vectorize it, and save it
//         // for (const text of paragraphs) {
//         //   // Get the 384 numbers from Hugging Face
//         //   const embeddingArray = await aiService.getEmbedding(text);

//         //   // Format the array into a string that PostgreSQL understands: '[0.1, 0.2, ...]'
//         //   const embeddingString = `[${embeddingArray.join(",")}]`;
//         //   const chunkId = randomUUID();

//         //   // 4. Save to Database
//         //   // Because pgvector is a special Postgres extension, Prisma requires us
//         //   // to use a raw SQL query to safely insert the numerical vector array.
//         //   await prisma.$executeRaw`
//         //   INSERT INTO "Chunk" (id, text, "documentId", embedding)
//         //   VALUES (${chunkId}, ${text}, ${documentId}, ${embeddingString}::vector)
//         // `;
//         // }

//         console.log(
//           `✅ [Job ${job.id}] Finished saving vectors to PostgreSQL!`,
//         );
//       } catch (error) {
//         console.error(`❌ [Job ${job.id}] Failed:`, error);
//         await prisma.document.update({
//           where: { id: documentId },
//           data: { status: "FAILED" },
//         });
//       }
//     },
//     { connection: redisConnection },
//   );
// };
