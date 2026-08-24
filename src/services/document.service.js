import prisma from "../config/db.js";
import { documentQueue } from "../config/queue.js";
import * as documentRepository from "../repositories/document.repository.js";

export const processAndSaveDocument = async (filename, filepath) => {
  if (!filename) {
    throw new Error("Filename is required");
  }

  // 1. Save metadata to DB via Repository
  // 2. Save metadata to Postgres so we have an ID
  const document = await documentRepository.createDocument(filename);

  // Later: Add a background job to Redis to extract text and generate vectors
  // 2. Add a job to Redis.
  // We pass the document ID and the physical file path so the background
  // worker knows which file to read and which database record to update.
  await documentQueue.add("extract-and-embed", {
    documentId: document.id,
    filepath: filepath,
  });

  return document;
};

export const getAllDocuments = async () => {
  return await documentRepository.findAllDocuments();
};
