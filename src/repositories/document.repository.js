import prisma from "../config/db.js";

export const createDocument = async (filename, userId, fileUrl) => {
  return await prisma.document.create({
    data: {
      filename,
      userId,
      fileUrl,
    },
  });
};

export const findAllDocuments = async () => {
  return await prisma.document.findMany({
    orderBy: { createdAt: "desc" },
  });
};

export const findSimilarChunks = async (questionEmbeddingArray, limit = 3) => {
  const embeddingString = `[${questionEmbeddingArray.join(",")}]`;
  const similarChunks = await prisma.$queryRaw`
    SELECT text
    FROM "Chunk"
    ORDER BY embedding <=> ${embeddingString}::vector
    LIMIT ${limit}  
  `;
  return similarChunks;
};

export const getDocumentsByUserId = async (userId) => {
  return await prisma.document.findMany({
    where: { userId },
    select: {
      id: true,
      filename: true,
      createdAt: true,
      fileUrl: true,
      status: true,
      summaryStatus: true,
    },
    orderBy: { createdAt: "desc" },
  });
};

export const getDocumentById = async (id) => {
  return await prisma.document.findUnique({
    where: { id },
  });
};

export const getOwnedDocument = async (id, userId) => {
  return prisma.document.findFirst({
    where: { id, userId },
    select: { id: true, userId: true, fileUrl: true, status: true },
  });
};

export const deleteOwnedDocument = async (id, userId) => {
  // Existing foreign keys cascade to parents, children, conversations and messages.
  return prisma.document.deleteMany({
    where: { id, userId, status: { in: ["COMPLETED", "FAILED"] } },
  });
};

export const getAllParentChunks = async (id) => {
  return await prisma.$queryRaw`
    SELECT
      id,
      text,
      metadata
    FROM "ParentChunk"
    WHERE "documentId" = ${id}
    ORDER BY (metadata->>'page_number')::int ASC
  `;
};

export const getParentChunkById = async (parentId) => {
  return await prisma.parentChunk.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      text: true,
      documentId: true,
      metadata: true,
    },
  });
};

export const getChildChunksByParentId = async (parentId) => {
  return await prisma.childChunk.findMany({
    where: { parentId },
    select: {
      id: true,
      text: true,
      parentId: true,
      documentId: true,
      metadata: true,
    },
  });
};
