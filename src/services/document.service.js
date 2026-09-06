import prisma from "../config/db.js";
import { documentQueue } from "../config/queue.js";
import * as documentRepository from "../repositories/document.repository.js";

export const processAndSaveDocument = async (
  filename,
  filepath,
  mimetype,
  userId,
  fileUrl,
) => {
  if (!filename) {
    throw new Error("Filename is required");
  }

  // 1. Save metadata to DB via Repository
  // 2. Save metadata to Postgres so we have an ID
  const document = await documentRepository.createDocument(
    filename,
    userId,
    fileUrl,
  );

  // Later: Add a background job to Redis to extract text and generate vectors
  // 2. Add a job to Redis.
  // We pass the document ID and the physical file path so the background
  // worker knows which file to read and which database record to update.
  await documentQueue.add("extract-and-embed", {
    documentId: document.id,
    filepath: filepath,
    mimetype: mimetype,
  });

  return document;
};

export const getAllDocuments = async () => {
  return await documentRepository.findAllDocuments();
};

export const getUserDocuments = async (userId) => {
  return await documentRepository.getDocumentsByUserId(userId);
};

export const getAllParentChunks = async (docId) => {
  return await documentRepository.getAllParentChunks(docId);
};

export const getChildChunksOfParent = async (parentId) => {
  if (!parentId) {
    throw new Error("Parent chunk id is required");
  }

  const parent = await documentRepository.getParentChunkById(parentId);

  if (!parent) {
    throw new Error("Parent chunk not found");
  }

  const children = await documentRepository.getChildChunksByParentId(parentId);

  return {
    parentId: parent.id,
    documentId: parent.documentId,
    parentText: parent.text,
    totalChildren: children.length,
    children,
  };
};
