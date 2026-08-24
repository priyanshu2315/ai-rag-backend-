import * as documentService from "../services/document.service.js";

export const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      throw new Error("No file uploaded");
    }

    const result = await documentService.processAndSaveDocument(
      req.file.filename,
      req.file.path,
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
