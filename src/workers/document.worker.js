import { Worker } from "bullmq";
import Redis from "ioredis";
import prisma from "../config/db.js";
import * as aiService from "../services/ai.service.js";
import { randomUUID } from "crypto";
import "dotenv/config";

const redisConnection = new Redis(process.env.REDIS_URL, {
  // host: "localhost",
  // port: 6379,
  maxRetriesPerRequest: null,
  tls: {},
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
        const rawText = await aiService.extractText(filepath, mimetype);

        // 2. "Chunking" - split the text by double line breaks (paragraphs)
        // We filter out chunks that are too short to be useful.
        const paragraphs = rawText
          .split("\n\n")
          .filter((p) => p.trim().length > 40);

        console.log(
          `[Job ${job.id}] Extracted ${paragraphs.length} paragraphs. Generating AI vectors...`,
        );

        for (const paragraphText of paragraphs) {
          const parent = await prisma.parentChunk.create({
            data: {
              documentId: documentId,
              text: paragraphText,
            },
          });

          const sentences = paragraphText
            .split(/(?<=[.?!])\s+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 10);

          for (const sentenceText of sentences) {
            const embeddingArray = await aiService.getEmbedding(sentenceText);
            const embeddingString = `[${embeddingArray.join(",")}]`;
            const childId = randomUUID();

            await prisma.$queryRaw`
            INSERT INTO "ChildChunk" (id, text, "parentId", "documentId", embedding)
            VALUES (${childId}, ${sentenceText}, ${parent.id}, ${documentId}, ${embeddingString}::vector)
            `;
          }
        }

        // // 3. Loop through each paragraph, vectorize it, and save it
        // for (const text of paragraphs) {
        //   // Get the 384 numbers from Hugging Face
        //   const embeddingArray = await aiService.getEmbedding(text);

        //   // Format the array into a string that PostgreSQL understands: '[0.1, 0.2, ...]'
        //   const embeddingString = `[${embeddingArray.join(",")}]`;
        //   const chunkId = randomUUID();

        //   // 4. Save to Database
        //   // Because pgvector is a special Postgres extension, Prisma requires us
        //   // to use a raw SQL query to safely insert the numerical vector array.
        //   await prisma.$executeRaw`
        //   INSERT INTO "Chunk" (id, text, "documentId", embedding)
        //   VALUES (${chunkId}, ${text}, ${documentId}, ${embeddingString}::vector)
        // `;
        // }

        console.log(
          `✅ [Job ${job.id}] Finished saving vectors to PostgreSQL!`,
        );
      } catch (error) {
        console.error(`❌ [Job ${job.id}] Failed:`, error);
      }
    },
    { connection: redisConnection },
  );
};
