import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import path from "path";
import fs from "fs";
import * as aiService from "./../services/ai.service.js";
import prisma from "../config/db.js";
import { supabase } from "../config/supabase.js";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_DOC_ID = "00000000-0000-0000-0002-000000000000";

async function seed() {
  const parentSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1200,
    chunkOverlap: 200,
  });
  const childSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 400,
    chunkOverlap: 50,
  });

  const originalname = "Northwind-Travel-Expense-Policy.pdf";
  const localFilepath = path.resolve(`./eval-docs/${originalname}`);
  const mimetype = "application/pdf";
  const fileBuffer = fs.readFileSync(localFilepath);

  const storagePath = `${TEST_USER_ID}/${Date.now()}-${originalname.replace(/\s+/g, "_")}`;

  const { data: storageData, error: storageError } = await supabase.storage
    .from("documents")
    .upload(storagePath, fileBuffer, {
      contentType: mimetype,
    });

  if (storageError) {
    throw new Error(`Supabase upload failed: ${storageError.message}`);
  }

  const { data: urlData } = supabase.storage
    .from("documents")
    .getPublicUrl(storageData.path);
  const fileUrl = urlData.publicUrl;

  console.log("--- Upserting Deterministic User & Document ---");
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    update: {},
    create: {
      id: TEST_USER_ID,
      email: "eval-user@test.local",
      password: "password",
    },
  });

  await prisma.document.upsert({
    where: { id: TEST_DOC_ID },
    update: {
      status: "COMPLETED",
      fileUrl: fileUrl,
    },
    create: {
      id: TEST_DOC_ID,
      filename: originalname,
      userId: TEST_USER_ID,
      status: "COMPLETED",
      fileUrl: fileUrl,
    },
  });

  await prisma.childChunk.deleteMany({ where: { documentId: TEST_DOC_ID } });
  await prisma.parentChunk.deleteMany({ where: { documentId: TEST_DOC_ID } });

  console.log(`--- Extracting text from PDF via LlamaParse/aiService ---`);
  const pages = await aiService.extractDocPages(storageData.path, mimetype);

  let globalChunkIndex = 0;
  const seededParents = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const pageText = pages[i].text || "";
    if (!pageText.trim()) continue;

    const parentDocs = await parentSplitter.createDocuments([pageText]);

    for (const parentDoc of parentDocs) {
      const parentId = TEST_DOC_ID.replace(
        /.{12}$/,
        String(globalChunkIndex).padStart(12, "0"),
      );

      await prisma.parentChunk.create({
        data: {
          id: parentId,
          text: parentDoc.pageContent,
          documentId: TEST_DOC_ID,
          metadata: {
            page_number: pageNumber,
            chunk_index: globalChunkIndex,
          },
        },
      });

      const childDocs = await childSplitter.createDocuments([
        parentDoc.pageContent,
      ]);

      for (let j = 0; j < childDocs.length; j++) {
        const childDoc = childDocs[j];
        const embeddingArray = await aiService.getEmbedding(
          childDoc.pageContent,
        );
        const embeddingString = `[${embeddingArray.join(",")}]`;

        const childId = `${parentId}-child-${j}`;
        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "ChildChunk" ("id", "text", "parentId", "documentId", "embedding", "metadata")
          VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
        `,
          childId,
          childDoc.pageContent,
          parentId,
          TEST_DOC_ID,
          embeddingString,
          JSON.stringify({ page_number: pageNumber }),
        );
      }

      seededParents.push({
        id: parentId,
        page: pageNumber,
        text: parentDoc.pageContent,
      });

      console.log(
        `Seeded parent ${globalChunkIndex} (Page ${pageNumber}) -> Generated ${childDocs.length} child chunks`,
      );
      globalChunkIndex++;
    }
  }

  console.log("\n--- Parent Chunks ---");
  for (const parent of seededParents) {
    console.log(`\n[${parent.id}] Page ${parent.page}\n${parent.text}`);
  }

  console.log("\n--- Seeding Complete: Database is Synchronized ---");
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
