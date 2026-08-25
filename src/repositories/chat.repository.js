import prisma from "../config/db.js";

export const searchSingleDocument = async (
  documentId,
  vectorStr,
  count = 1,
) => {
  // Step 1: Find the top matching child sentences
  // Step 2: Return their distinct parent paragraphs
  return await prisma.$queryRaw`
    WITH top_children AS (
      SELECT "parentId", "embedding" <=> ${vectorStr}::vector AS distance
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
      ORDER BY distance
      LIMIT ${count}
    )
    SELECT DISTINCT p.text
    FROM top_children t
    JOIN "ParentChunk" p ON t."parentId" = p.id;
  `;
};

export const searchAllUserDocuments = async (userId, vectorStr, count = 1) => {
  return await prisma.$queryRaw`
    WITH top_children AS (
      SELECT c."parentId", c."embedding" <=> ${vectorStr}::vector AS distance
      FROM "ChildChunk" c
      JOIN "Document" d ON c."documentId" = d.id
      WHERE d."userId" = ${userId}
      ORDER BY distance
      LIMIT ${count}
    )
    SELECT DISTINCT p.text
    FROM top_children t
    JOIN "ParentChunk" p ON t."parentId" = p.id;
  `;
};
