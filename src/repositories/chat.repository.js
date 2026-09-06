// import prisma from "../config/db.js";

// export const searchSingleDocument = async (
//   documentId,
//   vectorStr,
//   count = 5,
// ) => {
//   // Step 1: Find the top matching child sentences
//   // Step 2: Return their distinct parent paragraphs
//   return await prisma.$queryRaw`
//     WITH top_children AS (
//       SELECT "parentId", "embedding" <=> ${vectorStr}::vector AS distance
//       FROM "ChildChunk"
//       WHERE "documentId" = ${documentId}
//       ORDER BY distance
//       LIMIT ${count}
//     )
//     SELECT DISTINCT p.text
//     FROM top_children t
//     JOIN "ParentChunk" p ON t."parentId" = p.id;
//   `;
// };

// export const searchAllUserDocuments = async (userId, vectorStr, count = 5) => {
//   return await prisma.$queryRaw`
//     WITH top_children AS (
//       SELECT c."parentId", c."embedding" <=> ${vectorStr}::vector AS distance
//       FROM "ChildChunk" c
//       JOIN "Document" d ON c."documentId" = d.id
//       WHERE d."userId" = ${userId}
//       ORDER BY distance
//       LIMIT ${count}
//     )
//     SELECT DISTINCT p.text
//     FROM top_children t
//     JOIN "ParentChunk" p ON t."parentId" = p.id;
//   `;
// };

import prisma from "../config/db.js";

export const searchSingleDocument = async (
  documentId,
  vectorStr,
  queryText,
  count = 5,
) => {
  const res = await prisma.$queryRaw`
    WITH vector_matches AS (
      SELECT 
        "parentId",
        ROW_NUMBER() OVER (ORDER BY "embedding" <=> ${vectorStr}::vector ASC) AS rank
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
      ORDER BY "embedding" <=> ${vectorStr}::vector ASC
      LIMIT 20
    ),
    keyword_matches AS (
      SELECT 
        "parentId",
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', ${queryText})) DESC
        ) AS rank
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
        AND to_tsvector('english', text) @@ plainto_tsquery('english', ${queryText})
      ORDER BY ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', ${queryText})) DESC
      LIMIT 20
    ),
    combined_scores AS (
      SELECT "parentId", (1.0 / (60 + rank)) AS score FROM vector_matches
      UNION ALL
      SELECT "parentId", (1.0 / (60 + rank)) AS score FROM keyword_matches
    ),
    ranked_parents AS (
      SELECT 
        "parentId",
        SUM(score) AS total_score
      FROM combined_scores
      GROUP BY "parentId"
      ORDER BY total_score DESC
      LIMIT ${count}
    )
    SELECT p.text, p.metadata
    FROM ranked_parents r
    JOIN "ParentChunk" p ON r."parentId" = p.id;
  `;
  return res;
};

export const searchAllUserDocuments = async (
  userId,
  vectorStr,
  queryText,
  count = 5,
) => {
  return await prisma.$queryRaw`
    WITH vector_matches AS (
      SELECT 
        c."parentId",
        ROW_NUMBER() OVER (ORDER BY c."embedding" <=> ${vectorStr}::vector ASC) AS rank
      FROM "ChildChunk" c
      JOIN "Document" d ON c."documentId" = d.id
      WHERE d."userId" = ${userId}
      ORDER BY c."embedding" <=> ${vectorStr}::vector ASC
      LIMIT 20
    ),
    keyword_matches AS (
      SELECT 
        c."parentId",
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(to_tsvector('english', c.text), plainto_tsquery('english', ${queryText})) DESC
        ) AS rank
      FROM "ChildChunk" c
      JOIN "Document" d ON c."documentId" = d.id
      WHERE d."userId" = ${userId}
        AND to_tsvector('english', c.text) @@ plainto_tsquery('english', ${queryText})
      ORDER BY ts_rank_cd(to_tsvector('english', c.text), plainto_tsquery('english', ${queryText})) DESC
      LIMIT 20
    ),
    combined_scores AS (
      SELECT "parentId", (1.0 / (60 + rank)) AS score FROM vector_matches
      UNION ALL
      SELECT "parentId", (1.0 / (60 + rank)) AS score FROM keyword_matches
    ),
    ranked_parents AS (
      SELECT 
        "parentId",
        SUM(score) AS total_score
      FROM combined_scores
      GROUP BY "parentId"
      ORDER BY total_score DESC
      LIMIT ${count}
    )
    SELECT p.text
    FROM ranked_parents r
    JOIN "ParentChunk" p ON r."parentId" = p.id;
  `;
};

export const getChunksByPage = async (documentId, pageNumber) => {
  const result = await prisma.$queryRaw`
    SELECT id, text, metadata 
    FROM "ParentChunk" 
    WHERE "documentId" = ${documentId}
      AND (metadata->>'page_number')::int = ${pageNumber}
    ORDER BY (metadata->>'chunk_index')::int ASC;
  `;
  return result;
};

export const saveMessage = async (conversationId, role, content) => {
  return await prisma.message.create({
    data: { conversationId, role, content },
  });
};

export const getChatHistory = async (conversationId, limit = 6) => {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  // Reverse to chronological order and format for the LLM
  return messages
    .reverse()
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");
};

export const getDocumentText = async (documentId) => {
  // Fetch up to 10 chunks to stay under token limits during summarization
  const chunks = await prisma.parentChunk.findMany({
    where: { documentId },
    take: 10,
  });
  return chunks.map((c) => c.text).join("\n\n");
};

export const getDocumentSummary = async (documentId) => {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { summary: true }, // Only pull the summary column
  });
  return doc?.summary || null;
};
// Add to src/repositories/chat.repository.js

export const getOrCreateConversation = async (userId, documentId) => {
  let conversation = await prisma.conversation.findFirst({
    where: {
      userId: userId,
      documentId: documentId || null,
    },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        userId: userId,
        documentId: documentId || null,
      },
      include: { messages: true },
    });
  }

  return conversation;
};
