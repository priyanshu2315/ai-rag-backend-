import prisma from "../config/db.js";

export const createDocument = async (filename, userId) => {
  return await prisma.document.create({
    data: {
      filename,
      userId,
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
    },
    orderBy: { createdAt: "desc" },
  });
};

export const getDocumentById = async (id) => {
  return await prisma.document.findUnique({
    where: { id },
  });
};
