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
    SELECT p.text
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
