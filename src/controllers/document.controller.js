import { supabase } from "../config/supabase.js";
import * as documentService from "../services/document.service.js";
import {
  createSubscriber,
  getChannel,
  getProgressHistory,
} from "../config/uploadProgress.js";
import { randomUUID } from "node:crypto";
import prisma from "../config/db.js";

export const streamProgress = async (req, res) => {
  const documentId = req.params.docId;

  // 1. Make sure the doc exists and belongs to this user
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.userId !== req.user.id) {
    return res
      .status(404)
      .json({ success: false, error: "Document not found" });
  }

  // 2. Same SSE headers you use in chat
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // 3. Start listening to this document's channel
  const subscriber = createSubscriber();
  let closed = false;
  let replaying = true;
  const waitingEvents = [];
  const sentIds = new Set();
  const cleanup = () => {
    if (closed) return;
    closed = true;
    subscriber.disconnect();
  };
  const send = (event) => {
    if (closed || (event.eventId && sentIds.has(event.eventId))) return;
    const payload = {
      documentId,
      timestamp: new Date().toISOString(),
      eventId: randomUUID(),
      ...event,
    };
    sentIds.add(payload.eventId);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const finish = (event) => {
    if (closed) return;
    send(event);
    cleanup();
    res.end();
  };
  res.on("close", cleanup);

  const dispatch = (event) => {
    if (closed || (event.eventId && sentIds.has(event.eventId))) return;
    if (
      event.type === "completed" ||
      event.type === "failed" ||
      event.type === "summary_failed"
    ) {
      finish(event);
    } else {
      send(event);
    }
  };

  subscriber.on("message", (channel, message) => {
    const event = JSON.parse(message);
    if (replaying) waitingEvents.push(event);
    else dispatch(event);
  });

  await subscriber.subscribe(getChannel(documentId));

  // Subscribe first, then replay: buffer live events and deduplicate their IDs.
  try {
    const history = await getProgressHistory(documentId);
    for (const event of history) dispatch(event);
  } catch (error) {
    console.error("Reading progress history failed:", error.message);
  }
  replaying = false;
  for (const event of waitingEvents) dispatch(event);
  if (closed) return;

  // 4. If it already finished before we connected, say so and stop
  const fresh = await prisma.document.findUnique({ where: { id: documentId } });
  if (closed) return;
  if (!fresh) {
    return finish({ type: "failed", message: "Document no longer exists" });
  }
  if (fresh.status === "FAILED") {
    return finish({ type: "failed" });
  }
  if (fresh.status === "COMPLETED") {
    send({ type: "chunks_ready" });
    if (fresh.summaryStatus === "COMPLETED" || fresh.summaryStatus === "FAILED") {
      return finish({
        type: fresh.summaryStatus === "COMPLETED" ? "completed" : "summary_failed",
      });
    }
    if (fresh.summaryStatus === "PROCESSING") {
      send({ type: "summarizing" });
    }
  }

};

export const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      throw new Error("No file uploaded");
    }
    const userId = req.user.id;
    const file = req.file;
    const storagePath = `${userId}/${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;

    // 2. Upload the buffer directly to Supabase Storage
    const { data: storageData, error: storageError } = await supabase.storage
      .from("documents") // Make sure this bucket exists in Supabase!
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
      });
    if (storageError)
      throw new Error(`Supabase upload failed: ${storageError.message}`);
    const { data: urlData } = supabase.storage
      .from("documents")
      .getPublicUrl(storageData.path);

    const fileUrl = urlData.publicUrl;

    const result = await documentService.processAndSaveDocument(
      file.originalname,
      storageData.path,
      file.mimetype,
      userId,
      fileUrl,
    );

    return res.status(202).json({
      // 202 means "Accepted for processing"
      success: true,
      message: "Document uploaded and queued for AI processing",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
};

export const listDocuments = async (req, res) => {
  try {
    const documents = await documentService.getAllDocuments();
    return res.status(200).json({
      success: true,
      data: documents,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getMyDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    const documents = await documentService.getUserDocuments(userId);

    return res.status(200).json({
      success: true,
      data: documents,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const deleteDocument = async (req, res) => {
  try {
    const result = await documentService.deleteDocument(req.params.docId, req.user?.id);
    return res.status(200).json({
      success: true,
      message: "Document deleted successfully",
      data: result,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) console.error("Document deletion failed:", error.message);
    return res.status(status).json({
      success: false,
      error: error.statusCode ? error.message : "Failed to delete document. Please try again.",
    });
  }
};

export const getAllParentChunks = async (req, res) => {
  try {
    const docId = req.params.docId;
    const parentChunks = await documentService.getAllParentChunks(docId, req.user.id);
    return res.status(200).json({
      success: true,
      data: parentChunks,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getChildChunksOfParent = async (req, res) => {
  try {
    const parentId = req.params.parentId;
    const result = await documentService.getChildChunksOfParent(parentId, req.user.id);
    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const status = error.message === "Parent chunk not found" ? 404 : 500;
    return res.status(status).json({
      success: false,
      error: error.message,
    });
  }
};
