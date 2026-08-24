import prisma from "../config/db.js";

export const searchSingleDocument = async (
  documentId,
  vectorStr,
  count = 5,
) => {
  return await prisma.$queryRaw`
    SELECT text
    FROM "Chunk"
    WHERE "documentId"=${documentId}
    ORDER BY "embedding" <=> ${vectorStr}::vector
    LIMIT ${count};
    `;
};

export const searchAllUserDocuments = async (userId, vectorStr, count) => {
  return await prisma.$queryRaw`
    SELECT c.text
    FROM "Chunk" c
    JOIN "Document" d ON c."documentId" = d.id
    WHERE d."userId" = ${userId}
    ORDER BY c."embedding" <=> ${vectorStr}::vector
    LIMIT ${count};
    `;
};
