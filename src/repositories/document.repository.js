import prisma from "../config/db.js";

export const createDocument = async (filename) => {
  return await prisma.document.create({
    data: {
      filename,
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
