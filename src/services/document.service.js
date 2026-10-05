import prisma from "../config/db.js";
import { documentQueue } from "../config/queue.js";
import * as documentRepository from "../repositories/document.repository.js";
import { supabase } from "../config/supabase.js";

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

const deletionError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

export const deleteDocument = async (documentId, userId) => {
  if (typeof userId !== "string" || !userId) {
    throw deletionError(401, "Unauthorized");
  }
  if (typeof documentId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId)) {
    throw deletionError(400, "Invalid document ID");
  }

  const document = await documentRepository.getOwnedDocument(documentId, userId);
  if (!document) throw deletionError(404, "Document not found");
  if (!["COMPLETED", "FAILED"].includes(document.status)) {
    throw deletionError(409, "Document is still processing. Try again when processing finishes.");
  }

  if (document.fileUrl) {
    // Uploads store a public URL rather than an object key. Only accept a key
    // in this Supabase project's documents bucket and this owner's folder.
    const fileUrl = new URL(document.fileUrl);
    const storageUrl = new URL(process.env.SUPABASE_URL);
    const prefix = "/storage/v1/object/public/documents/";
    if (fileUrl.origin !== storageUrl.origin || !fileUrl.pathname.startsWith(prefix)) {
      throw new Error("Unrecognized document storage URL");
    }
    const storagePath = decodeURIComponent(fileUrl.pathname.slice(prefix.length));
    if (!storagePath.startsWith(`${userId}/`) || storagePath === `${userId}/` ||
        storagePath.includes("\\") || storagePath.includes("\0") ||
        storagePath.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Invalid document storage path");
    }

    // Remove storage first: if it fails, retain the DB record for a retry.
    // If DB deletion fails afterwards, the same DELETE can be retried safely.
    const { error } = await supabase.storage.from("documents").remove([storagePath]);
    if (error && String(error.statusCode) !== "404") {
      throw deletionError(502, "Could not delete the uploaded file. Please try again.");
    }
  }

  const result = await documentRepository.deleteOwnedDocument(documentId, userId);
  if (result.count === 0) throw deletionError(404, "Document not found");
  return { documentId };
};

export const getAllParentChunks = async (docId, userId) => {
  const document = await documentRepository.getOwnedDocument(docId, userId);
  if (!document) throw deletionError(404, "Document not found");
  return await documentRepository.getAllParentChunks(docId);
};

export const getChildChunksOfParent = async (parentId, userId) => {
  if (!parentId) {
    throw new Error("Parent chunk id is required");
  }

  const parent = await documentRepository.getParentChunkById(parentId, userId);

  if (!parent) {
    throw new Error("Parent chunk not found");
  }

  const children = await documentRepository.getChildChunksByParentId(parentId);

  return {
    parentId: parent.id,
    documentId: parent.documentId,
    parentText: parent.text,
    parent: { ...parent, totalChildren: children.length },
    totalChildren: children.length,
    children,
  };
};
