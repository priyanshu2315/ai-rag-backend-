import prisma from "../config/db.js";
import { documentQueue } from "../config/queue.js";
import * as documentRepository from "../repositories/document.repository.js";
import { supabase } from "../config/supabase.js";
import * as accessService from "./access.service.js";
import { downloadDocument } from "./ai.service.js";
import { hashFile, extractUnits, diffUnits } from "./document-units.service.js";

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

export const getUserDocuments = async (user) => {
  const ids = await accessService.getAccessibleDocumentIds(user);
  return await documentRepository.getDocumentsByIds(ids);
};

const deletionError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Uploads store a public URL rather than an object key. Turn it back into the key, and only
// accept a key in this Supabase project's documents bucket and the uploader's folder.
function storagePathOf(document) {
  const fileUrl = new URL(document.fileUrl);
  const storageUrl = new URL(process.env.SUPABASE_URL);
  const prefix = "/storage/v1/object/public/documents/";
  if (
    fileUrl.origin !== storageUrl.origin ||
    !fileUrl.pathname.startsWith(prefix)
  ) {
    throw new Error("Unrecognized document storage URL");
  }
  const storagePath = decodeURIComponent(fileUrl.pathname.slice(prefix.length));
  if (
    !storagePath.startsWith(`${document.userId}/`) ||
    storagePath === `${document.userId}/` ||
    storagePath.includes("\\") ||
    storagePath.includes("\0") ||
    storagePath.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("Invalid document storage path");
  }
  return storagePath;
}

export const deleteDocument = async (documentId, userId) => {
  if (typeof userId !== "string" || !userId) {
    throw deletionError(401, "Unauthorized");
  }
  if (
    typeof documentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      documentId,
    )
  ) {
    throw deletionError(400, "Invalid document ID");
  }

  const document = await documentRepository.getDocumentForDelete(documentId);
  if (!document) throw deletionError(404, "Document not found");
  if (!["COMPLETED", "FAILED"].includes(document.status)) {
    throw deletionError(
      409,
      "Document is still processing. Try again when processing finishes.",
    );
  }

  if (document.fileUrl) {
    const storagePath = storagePathOf(document);

    // Remove storage first: if it fails, retain the DB record for a retry.
    // If DB deletion fails afterwards, the same DELETE can be retried safely.
    const { error } = await supabase.storage
      .from("documents")
      .remove([storagePath]);
    if (error && String(error.statusCode) !== "404") {
      throw deletionError(
        502,
        "Could not delete the uploaded file. Please try again.",
      );
    }
  }

  const result = await documentRepository.deleteDocumentById(documentId);
  if (result.count === 0) throw deletionError(404, "Document not found");
  return { documentId };
};

// Sentences of the current version: saved at upload, or (documents uploaded before units
// existed) read once from the stored PDF. null = nothing to compare with.
async function loadOldUnits(document) {
  const saved = await documentRepository.getDocumentUnits(document.id);
  if (saved.length) return saved;
  if (!document.fileUrl) return null;
  return extractUnits(await downloadDocument(storagePathOf(document)));
}

export const replaceDocument = async (documentId, file) => {
  if (typeof documentId !== "string" || !UUID.test(documentId)) {
    throw deletionError(400, "Invalid document ID");
  }
  if (!file) throw deletionError(400, "No file uploaded");
  if (file.mimetype !== "application/pdf") {
    throw deletionError(400, "Only a PDF can replace a document");
  }

  const document = await documentRepository.getDocumentForReplace(documentId);
  if (!document) throw deletionError(404, "Document not found");
  if (document.status !== "COMPLETED") {
    throw deletionError(409, "Only a fully processed document can be replaced");
  }

  // One replace per document at a time: the job ID is fixed per document.
  const jobId = `replace-${documentId}`;
  const running = await documentQueue.getJob(jobId);
  if (
    running &&
    ["waiting", "active", "delayed", "prioritized"].includes(
      await running.getState(),
    )
  ) {
    throw deletionError(
      409,
      "A replacement for this document is already running",
    );
  }

  // Gate 1: the exact same file.
  const fileHash = hashFile(file.buffer);
  if (fileHash === document.fileHash) {
    return { documentId, changed: false, reason: "same_file" };
  }

  // Gate 2: the same sentences (a re-saved or re-exported PDF). Skipped when the new PDF has
  // no text layer (scanned) or the old version cannot be read; the job then checks everything.
  const newUnits = await extractUnits(file.buffer);
  const oldUnits = newUnits.length ? await loadOldUnits(document) : null;
  let diff = null;
  if (oldUnits?.length) {
    const { kept, added, removed, moved } = diffUnits(oldUnits, newUnits);
    if (!added.length && !removed.length) {
      return {
        documentId,
        changed: false,
        reason: "same_text",
        moved: moved.length,
      };
    }
    diff = {
      kept,
      added: added.length,
      removed: removed.length,
      moved: moved.length,
    };
  }

  // Something changed: store the new PDF in the uploader's folder (deleteDocument checks it).
  const storagePath = `${document.userId}/${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
  const { data: stored, error } = await supabase.storage
    .from("documents")
    .upload(storagePath, file.buffer, { contentType: file.mimetype });

  if (error)
    throw deletionError(502, "Could not store the new file. Please try again.");

  const { data: urlData } = supabase.storage
    .from("documents")
    .getPublicUrl(stored.path);

  const version = document.version + 1;
  await documentQueue.add(
    "replace-document",
    {
      documentId,
      filepath: stored.path,
      mimetype: file.mimetype,
      filename: file.originalname,
      fileUrl: urlData.publicUrl,
      fileHash,
      version,
      oldFilepath: document.fileUrl ? storagePathOf(document) : null,
    },
    { jobId, removeOnComplete: true, removeOnFail: true },
  );

  return { documentId, changed: true, version, diff };
};

export const getAllParentChunks = async (docId, user) => {
  if (!(await accessService.canAccessDocument(user, docId))) {
    throw deletionError(404, "Document not found");
  }
  return await documentRepository.getAllParentChunks(docId);
};

export const getChildChunksOfParent = async (parentId, user) => {
  if (!parentId) {
    throw new Error("Parent chunk id is required");
  }

  const parent = await documentRepository.getParentChunkById(parentId);

  if (
    !parent ||
    !(await accessService.canAccessDocument(user, parent.documentId))
  ) {
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

const sectionOf = (chunk) =>
  (chunk.metadata?.heading_path ?? []).join(" > ") || "Title and cover";
const toCard = (chunk) => ({
  id: chunk.id,
  text: chunk.text,
  pages: chunk.metadata?.source_pages ?? [chunk.metadata?.page_number],
});
const byChunkIndex = (a, b) =>
  (a.metadata?.chunk_index ?? 0) - (b.metadata?.chunk_index ?? 0);

// What one replace changed, per section: old text next to new text.
export const getVersionChanges = async (documentId, user, versionParam) => {
  if (typeof documentId !== "string" || !UUID.test(documentId)) {
    throw deletionError(400, "Invalid document ID");
  }
  if (!(await accessService.canAccessDocument(user, documentId))) {
    throw deletionError(404, "Document not found");
  }
  const document = await documentRepository.getDocumentForReplace(documentId);
  if (!document) throw deletionError(404, "Document not found");
  if (document.version < 2) {
    throw deletionError(400, "This document has only one version");
  }
  const version =
    versionParam === undefined ? document.version : Number(versionParam);
  if (!Number.isInteger(version) || version < 2 || version > document.version) {
    throw deletionError(400, `version must be between 2 and ${document.version}`);
  }

  const { added, removed, kept } = await documentRepository.getVersionChanges(
    documentId,
    version,
  );

  // Pair old and new chunks of the same section as "changed"; the rest are added or removed.
  const oldBySection = new Map();
  for (const chunk of removed.sort(byChunkIndex)) {
    const section = sectionOf(chunk);
    if (!oldBySection.has(section)) oldBySection.set(section, []);
    oldBySection.get(section).push(chunk);
  }
  const changes = [];
  for (const chunk of added.sort(byChunkIndex)) {
    const section = sectionOf(chunk);
    const old = oldBySection.get(section)?.shift();
    changes.push(
      old
        ? { section, type: "changed", before: toCard(old), after: toCard(chunk) }
        : { section, type: "added", after: toCard(chunk) },
    );
  }
  for (const [section, left] of oldBySection) {
    for (const old of left) {
      changes.push({ section, type: "removed", before: toCard(old) });
    }
  }

  return {
    documentId,
    version,
    currentVersion: document.version,
    keptChunks: kept,
    changes,
  };
};
