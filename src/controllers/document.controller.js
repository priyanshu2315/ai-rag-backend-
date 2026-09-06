import { supabase } from "../config/supabase.js";
import * as documentService from "../services/document.service.js";

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

export const getAllParentChunks = async (req, res) => {
  try {
    const docId = req.params.docId;
    const parentChunks = await documentService.getAllParentChunks(docId);
    return res.status(200).json({
      success: true,
      data: parentChunks,
    });
  } catch (error) {}
};

export const getChildChunksOfParent = async (req, res) => {
  try {
    const parentId = req.params.parentId;
    const result = await documentService.getChildChunksOfParent(parentId);
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
