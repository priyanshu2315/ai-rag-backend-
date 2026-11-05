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
import { RAG_CONFIG } from "../config/rag.config.js";

function buildRelaxedTsQuery(queryText) {
  if (!queryText) return "";
  const stopWords = new Set([
    "what",
    "is",
    "the",
    "in",
    "of",
    "and",
    "to",
    "for",
    "a",
    "an",
    "on",
    "with",
    "how",
    "when",
    "where",
    "which",
    "did",
    "does",
  ]);
  const terms = queryText
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && !stopWords.has(t));

  // Only stop words left: skip keyword search instead of sending invalid tsquery syntax
  if (terms.length === 0) return "";
  // Join with ' | ' (OR) so partial keyword matches still surface chunks containing specific IDs or codes
  return terms.join(" | ");
}

// Tags each parent with the searches that found it, so the chat trace can show where it came from
const SEARCH_SOURCES = ["vector", "identifier", "phrase", "keyword"];
const withMatchSources = (rows) =>
  rows.map((row) => ({
    ...row,
    matchedBy: SEARCH_SOURCES.filter((source) => row[`${source}Rank`] != null),
  }));

// Accepts a plain string or { text, keywords, identifiers, entities } from the question planner
export function buildSearchTiers(queryInput) {
  const isObject = typeof queryInput === "object" && queryInput !== null;
  const text = String((isObject ? queryInput.text : queryInput) || "");
  const keywords =
    isObject && Array.isArray(queryInput.keywords) ? queryInput.keywords : [];
  const identifiers =
    isObject && Array.isArray(queryInput.identifiers)
      ? queryInput.identifiers
      : [];
  const entities =
    isObject && Array.isArray(queryInput.entities) ? queryInput.entities : [];

  // Tier 1: exact codes, e.g. '%PBLU-4471902%'. Very short IDs would match almost everything.
  const idPatterns = identifiers
    .map((id) => String(id).trim())
    .filter((id) => id.length >= 3)
    .map((id) => `%${id}%`);

  // Tier 2: names as phrases, e.g. '(new <-> zealand) | (audit <-> committee)'
  const phraseQuery = entities
    .map((entity) =>
      String(entity)
        .replace(/[^\w\s]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(" <-> "),
    )
    .filter(Boolean)
    .map((phrase) => `(${phrase})`)
    .join(" | ");

  // Tier 3: planner keywords when given; plain-string queries fall back to every useful word in the text.
  // Both go through buildRelaxedTsQuery so odd characters never reach to_tsquery.
  const wordQuery = buildRelaxedTsQuery(
    keywords.length ? keywords.join(" ") : text,
  );

  return { text, idPatterns, phraseQuery, wordQuery };
}

export const searchSingleDocument = async (
  documentId,
  vectorStr,
  queryInput,
  count = RAG_CONFIG.SEARCH_PARENT_CANDIDATES,
) => {
  const { text, idPatterns, phraseQuery, wordQuery } =
    buildSearchTiers(queryInput);
  const res = await prisma.$queryRaw`
    WITH vector_matches AS (
      SELECT 
        "parentId",
        ROW_NUMBER() OVER (
          ORDER BY "embedding" <=> ${vectorStr}::vector ASC
        ) AS rank
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
        AND (metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY "embedding" <=> ${vectorStr}::vector ASC
      LIMIT ${RAG_CONFIG.SEARCH_VECTOR_MATCH_LIMIT}
    ),

    id_matches AS (
      SELECT 
        "parentId",
        ROW_NUMBER() OVER (ORDER BY id) AS rank
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
        AND "searchText" ILIKE ANY(${idPatterns}::text[])
        AND (metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY rank
      LIMIT ${RAG_CONFIG.SEARCH_KEYWORD_MATCH_LIMIT}
    ),

    phrase_matches AS (
      SELECT 
        "parentId",
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', "searchText"),
            to_tsquery('english', ${phraseQuery})
          ) DESC
        ) AS rank
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
        AND ${phraseQuery}::text <> ''
        AND to_tsvector('english', "searchText")
            @@ to_tsquery('english', ${phraseQuery})
        AND (metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY rank
      LIMIT ${RAG_CONFIG.SEARCH_KEYWORD_MATCH_LIMIT}
    ),

    keyword_matches AS (
      SELECT 
        "parentId",
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', "searchText"),
            to_tsquery('english', ${wordQuery})
          ) DESC
        ) AS rank
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
        AND ${wordQuery}::text <> ''
        AND to_tsvector('english', "searchText")
            @@ to_tsquery('english', ${wordQuery})
        AND (metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY rank
      LIMIT ${RAG_CONFIG.SEARCH_KEYWORD_MATCH_LIMIT}
    ),

    keyword_debug AS (
      SELECT COUNT(*) AS keyword_count
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
        AND ${wordQuery}::text <> ''
        AND to_tsvector('english', "searchText")
            @@ to_tsquery('english', ${wordQuery})
        AND (metadata->>'is_toc') IS DISTINCT FROM 'true'
    ),

    vector_debug AS (
      SELECT COUNT(*) AS vector_count
      FROM "ChildChunk"
      WHERE "documentId" = ${documentId}
        AND (metadata->>'is_toc') IS DISTINCT FROM 'true'
    ),

    -- Weighted RRF: exact IDs count most, then phrases, then vector and keywords
    combined_scores AS (
      SELECT "parentId", 'vector' AS source, rank, (1.0 / (10 + rank)) AS score FROM vector_matches
      UNION ALL
      SELECT "parentId", 'identifier', rank, (2.5 / (10 + rank)) FROM id_matches
      UNION ALL
      SELECT "parentId", 'phrase', rank, (1.5 / (10 + rank)) FROM phrase_matches
      UNION ALL
      SELECT "parentId", 'keyword', rank, (1.0 / (10 + rank)) FROM keyword_matches
    ),

    ranked_parents AS (
      SELECT 
        "parentId",
        SUM(score) AS total_score,
        -- Best child rank per search; NULL means that search did not find this parent
        MIN(rank) FILTER (WHERE source = 'vector') AS vector_rank,
        MIN(rank) FILTER (WHERE source = 'identifier') AS identifier_rank,
        MIN(rank) FILTER (WHERE source = 'phrase') AS phrase_rank,
        MIN(rank) FILTER (WHERE source = 'keyword') AS keyword_rank
      FROM combined_scores
      GROUP BY "parentId"
      ORDER BY total_score DESC
      LIMIT ${count}
    )

    SELECT
      p.id,
      p.text,
      p."searchText",
      p."documentId",
      p."prevParentId",
      p."nextParentId",
      d."fileUrl",
      d.filename AS "documentTitle",
      p.metadata,
      r.total_score::double precision AS "retrievalScore",
      (SELECT keyword_count FROM keyword_debug)::int AS "keywordCount",
      (SELECT vector_count FROM vector_debug)::int AS "vectorCount",

      r.vector_rank::int AS "vectorRank",
      r.identifier_rank::int AS "identifierRank",
      r.phrase_rank::int AS "phraseRank",
      r.keyword_rank::int AS "keywordRank"

    FROM ranked_parents r
    JOIN "ParentChunk" p ON r."parentId" = p.id
    JOIN "Document" d ON p."documentId" = d.id
    ORDER BY r.total_score DESC;
  `;

  console.log("🔍 SINGLE DOCUMENT SEARCH DEBUG:", {
    documentId,
    queryText: text,
    idPatterns,
    phraseQuery,
    relaxedQuery: wordQuery,
    keywordMatches: Number(res[0]?.keywordCount ?? 0),
    vectorCandidates: Number(res[0]?.vectorCount ?? 0),
    finalParents: res.length,
  });

  return withMatchSources(res);
};

export const searchAllUserDocuments = async (
  userId,
  vectorStr,
  queryInput,
  count = RAG_CONFIG.SEARCH_PARENT_CANDIDATES,
) => {
  const { text, idPatterns, phraseQuery, wordQuery } =
    buildSearchTiers(queryInput);

  const vectorLimit = Math.max(30, RAG_CONFIG.SEARCH_VECTOR_MATCH_LIMIT);
  const keywordLimit = Math.max(30, RAG_CONFIG.SEARCH_KEYWORD_MATCH_LIMIT);
  const candidateCount = Math.max(20, count);

  const res = await prisma.$queryRaw`
    WITH active_docs AS (
      SELECT DISTINCT ON (filename) id
      FROM "Document"
      WHERE "userId" = ${userId}
        AND "status" = 'COMPLETED'
      ORDER BY filename, "createdAt" DESC
    ),

    vector_matches AS (
      SELECT 
        c."parentId",
        ROW_NUMBER() OVER (
          ORDER BY c."embedding" <=> ${vectorStr}::vector ASC
        ) AS rank
      FROM "ChildChunk" c
      JOIN active_docs ad ON c."documentId" = ad.id
      WHERE (c.metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY c."embedding" <=> ${vectorStr}::vector ASC
      LIMIT ${vectorLimit}
    ),

    id_matches AS (
      SELECT 
        c."parentId",
        ROW_NUMBER() OVER (ORDER BY c.id) AS rank
      FROM "ChildChunk" c
      JOIN active_docs ad ON c."documentId" = ad.id
      WHERE c."searchText" ILIKE ANY(${idPatterns}::text[])
        AND (c.metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY rank
      LIMIT ${keywordLimit}
    ),

    phrase_matches AS (
      SELECT 
        c."parentId",
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', c."searchText"),
            to_tsquery('english', ${phraseQuery})
          ) DESC
        ) AS rank
      FROM "ChildChunk" c
      JOIN active_docs ad ON c."documentId" = ad.id
      WHERE ${phraseQuery}::text <> ''
        AND to_tsvector('english', c."searchText")
            @@ to_tsquery('english', ${phraseQuery})
        AND (c.metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY rank
      LIMIT ${keywordLimit}
    ),

    keyword_matches AS (
      SELECT 
        c."parentId",
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', c."searchText"),
            to_tsquery('english', ${wordQuery})
          ) DESC
        ) AS rank
      FROM "ChildChunk" c
      JOIN active_docs ad ON c."documentId" = ad.id
      WHERE ${wordQuery}::text <> ''
        AND to_tsvector('english', c."searchText")
            @@ to_tsquery('english', ${wordQuery})
        AND (c.metadata->>'is_toc') IS DISTINCT FROM 'true'
      ORDER BY rank
      LIMIT ${keywordLimit}
    ),

    keyword_debug AS (
      SELECT COUNT(*) AS keyword_count
      FROM "ChildChunk" c
      JOIN active_docs ad ON c."documentId" = ad.id
      WHERE ${wordQuery}::text <> ''
        AND to_tsvector('english', c."searchText")
            @@ to_tsquery('english', ${wordQuery})
        AND (c.metadata->>'is_toc') IS DISTINCT FROM 'true'
    ),

    vector_debug AS (
      SELECT COUNT(*) AS vector_count
      FROM "ChildChunk" c
      JOIN active_docs ad ON c."documentId" = ad.id
      WHERE (c.metadata->>'is_toc') IS DISTINCT FROM 'true'
    ),

    -- Weighted RRF: exact IDs count most, then phrases, then vector and keywords
    combined_scores AS (
      SELECT "parentId", 'vector' AS source, rank, (1.0 / (10 + rank)) AS score FROM vector_matches
      UNION ALL
      SELECT "parentId", 'identifier', rank, (2.5 / (10 + rank)) FROM id_matches
      UNION ALL
      SELECT "parentId", 'phrase', rank, (1.5 / (10 + rank)) FROM phrase_matches
      UNION ALL
      SELECT "parentId", 'keyword', rank, (1.0 / (10 + rank)) FROM keyword_matches
    ),

    ranked_parents AS (
      SELECT 
        "parentId",
        SUM(score) AS total_score,
        -- Best child rank per search; NULL means that search did not find this parent
        MIN(rank) FILTER (WHERE source = 'vector') AS vector_rank,
        MIN(rank) FILTER (WHERE source = 'identifier') AS identifier_rank,
        MIN(rank) FILTER (WHERE source = 'phrase') AS phrase_rank,
        MIN(rank) FILTER (WHERE source = 'keyword') AS keyword_rank
      FROM combined_scores
      GROUP BY "parentId"
      ORDER BY total_score DESC
      LIMIT ${candidateCount}
    )

    SELECT
      p.id,
      p.text,
      p."searchText",
      p."documentId",
      p."prevParentId",
      p."nextParentId",
      p.metadata,
      d."fileUrl",
      d.filename AS "documentTitle",
      r.total_score::double precision AS "retrievalScore",
        (SELECT keyword_count FROM keyword_debug)::int AS "keywordCount",
      (SELECT vector_count FROM vector_debug)::int AS "vectorCount",

      r.vector_rank::int AS "vectorRank",
      r.identifier_rank::int AS "identifierRank",
      r.phrase_rank::int AS "phraseRank",
      r.keyword_rank::int AS "keywordRank"

    FROM ranked_parents r
    JOIN "ParentChunk" p ON r."parentId" = p.id
    JOIN "Document" d ON p."documentId" = d.id
    ORDER BY r.total_score DESC;
  `;

  console.log("🔍 SEARCH DEBUG:", {
    userId,
    queryText: text,
    idPatterns,
    phraseQuery,
    relaxedQuery: wordQuery,
    keywordMatches: Number(res[0]?.keywordCount ?? 0),
    vectorCandidates: Number(res[0]?.vectorCount ?? 0),
    finalParents: res.length,
  });

  return withMatchSources(res);
};

export const getChunksByPage = async (documentId, pageNumber) => {
  const result = await prisma.$queryRaw`
    SELECT 
      p.id, 
      p.text, 
      p."searchText", 
      p."documentId", 
      p.metadata,
      d."fileUrl",
      d.filename AS "documentTitle"
    FROM "ParentChunk" p
    JOIN "Document" d ON p."documentId" = d.id
    WHERE p."documentId" = ${documentId}
      AND (
        (p.metadata->>'page_number')::int = ${pageNumber}
        OR (p.metadata->'source_pages')::jsonb @> ${JSON.stringify([pageNumber])}::jsonb
      )
    ORDER BY (p.metadata->>'chunk_index')::int ASC;
  `;
  return result;
};

export const saveMessage = async (
  conversationId,
  role,
  content,
  metadata = null,
) => {
  return await prisma.message.create({
    data: { conversationId, role, content, metadata },
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
    .map((m) => {
      let content = m.content.trim();
      // Truncate long assistant answers so history stays under ~200 tokens
      if (m.role === "assistant" && content.length > 200) {
        content = content.slice(0, 200).replace(/\n+/g, " ") + "...";
      }
      return `${m.role.toUpperCase()}: ${content}`;
    })
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

export const getDocumentSummaryState = (documentId) =>
  prisma.document.findUnique({
    where: { id: documentId },
    select: { summary: true, summaryStatus: true },
  });
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

export const clearConversationMessages = async (userId, documentId) => {
  const result = await prisma.message.deleteMany({
    where: {
      conversation: {
        userId: userId,
        documentId: documentId || null,
      },
    },
  });
  return result.count;
};

export async function getParentNeighbors(
  parents,
  userId,
  question = null,
  db = prisma,
) {
  const prismaClient =
    db && typeof db === "object" && db.parentChunk ? db : prisma;
  const result = [...parents];
  const addedIds = new Set(parents.map((parent) => parent.id));

  // Guard: Never allow total returned chunks to exceed configured limit
  const MAX_TOTAL_CHUNKS = RAG_CONFIG.MAX_TOTAL_CHUNKS_PER_ROUND;
  if (result.length >= MAX_TOTAL_CHUNKS) return result;

  // Only examine the top reranked seed chunks for targeted expansion
  const seedParents = parents.slice(0, RAG_CONFIG.EXPANSION_SEED_COUNT);
  const questionLower = (question || "").toLowerCase();

  // 1. Targeted Section Context: Immediate Siblings (prev/next) + Section Lead (Parent 0 for headers)
  for (const parent of seedParents) {
    if (result.length >= MAX_TOTAL_CHUNKS) break;
    const sectionId = parent.metadata?.section_id;
    if (!sectionId) continue;

    // A) Immediate Siblings: Fetch predecessor (prevParentId) and successor (nextParentId)
    const siblingIds = [parent.prevParentId, parent.nextParentId].filter(
      Boolean,
    );
    if (siblingIds.length > 0) {
      const siblings = await prismaClient.parentChunk.findMany({
        where: {
          id: { in: siblingIds },
          document: { userId, status: "COMPLETED" },
        },
        include: {
          document: { select: { fileUrl: true, filename: true } },
        },
      });

      for (const chunk of siblings) {
        if (!addedIds.has(chunk.id) && result.length < MAX_TOTAL_CHUNKS) {
          addedIds.add(chunk.id);
          result.push({
            ...chunk,
            fileUrl: chunk.document?.fileUrl || parent.fileUrl || null,
            documentTitle:
              chunk.document?.filename || parent.documentTitle || null,
            retrievalOrigin: {
              type: "section_sibling",
              seedParentId: parent.id,
              sectionId,
            },
          });
        }
      }
    }

    // B) Section Lead (Parent 0): If anchor is a mid-section row, fetch the first chunk of the section for table headers & scope notes
    const partIndex = Number(parent.metadata?.section_part_index ?? 0);
    if (partIndex > 0 && result.length < MAX_TOTAL_CHUNKS) {
      const sectionLead = await prismaClient.parentChunk.findFirst({
        where: {
          documentId: parent.documentId,
          metadata: { path: ["section_id"], equals: sectionId },
          document: { userId, status: "COMPLETED" },
        },
        orderBy: { createdAt: "asc" },
        include: {
          document: { select: { fileUrl: true, filename: true } },
        },
      });

      if (sectionLead && !addedIds.has(sectionLead.id)) {
        addedIds.add(sectionLead.id);
        result.push({
          ...sectionLead,
          fileUrl: sectionLead.document?.fileUrl || parent.fileUrl || null,
          documentTitle:
            sectionLead.document?.filename || parent.documentTitle || null,
          retrievalOrigin: {
            type: "section_lead",
            seedParentId: parent.id,
            sectionId,
          },
        });
      }
    }

    // C) Chapter / Workflow Expansion: If user asks for a full process or policy, fetch sequential chapter chunks
    const rootChapter = parent.metadata?.heading_path?.[0];
    const isProcessOrOverview =
      /process|step|flow|procedure|overview|policy|guide|sop/i.test(
        questionLower,
      );

    if (
      isProcessOrOverview &&
      rootChapter &&
      result.length < MAX_TOTAL_CHUNKS
    ) {
      const chapterChunks = await prismaClient.$queryRaw`
        SELECT p.id, p.text, p."searchText", p."documentId", p."prevParentId", p."nextParentId",
               p.metadata, d."fileUrl", d.filename AS "documentTitle"
        FROM "ParentChunk" p
        JOIN "Document" d ON p."documentId" = d.id
        WHERE p."documentId" = ${parent.documentId}
          AND d."userId" = ${userId}
          AND d."status" = 'COMPLETED'
          AND (p.metadata->>'is_toc') IS DISTINCT FROM 'true'
          AND p.metadata->'heading_path'->>0 = ${rootChapter}
        ORDER BY (p.metadata->>'chunk_index')::int ASC
        LIMIT ${RAG_CONFIG.MAX_CHAPTER_EXPANSION_CHUNKS};
      `;

      for (const chunk of chapterChunks) {
        if (!addedIds.has(chunk.id) && result.length < MAX_TOTAL_CHUNKS) {
          addedIds.add(chunk.id);
          result.push({
            ...chunk,
            fileUrl: chunk.fileUrl || parent.fileUrl || null,
            documentTitle: chunk.documentTitle || parent.documentTitle || null,
            retrievalOrigin: {
              type: "chapter_expansion",
              seedParentId: parent.id,
              chapter: rootChapter,
            },
          });
        }
      }
    }
  }

  // 2. Table Continuation: If a table crossed page/section boundaries, fetch related table part
  const tableKeys = new Map();
  for (const parent of seedParents) {
    const tableIds = [
      ...(parent.metadata?.table_ids ?? []),
      ...(parent.metadata?.linked_table_ids ?? []),
    ];

    for (const tableId of tableIds) {
      if (!tableId) continue;
      tableKeys.set(`${parent.documentId}:${tableId}`, {
        documentId: parent.documentId,
        tableId,
        seedParentId: parent.id,
      });
    }
  }

  for (const { documentId, tableId, seedParentId } of tableKeys.values()) {
    if (result.length >= MAX_TOTAL_CHUNKS) break;

    const related = await prismaClient.parentChunk.findMany({
      where: {
        documentId,
        document: { userId, status: "COMPLETED" },
        OR: [
          { metadata: { path: ["table_ids"], array_contains: [tableId] } },
          {
            metadata: { path: ["linked_table_ids"], array_contains: [tableId] },
          },
        ],
      },
      include: {
        document: { select: { fileUrl: true, filename: true } },
      },
      take: RAG_CONFIG.MAX_TABLE_CONTINUATION_CHUNKS,
    });

    for (const parent of related) {
      if (!addedIds.has(parent.id) && result.length < MAX_TOTAL_CHUNKS) {
        addedIds.add(parent.id);
        result.push({
          ...parent,
          fileUrl: parent.document?.fileUrl || null,
          documentTitle: parent.document?.filename || null,
          retrievalOrigin: {
            type: "table_continuation",
            seedParentId,
            tableId,
          },
        });
      }
    }
  }

  // 3. Selective Reference-Following: Follow citations ONLY when relevant or high-value override
  const referencedTargets = new Map();

  for (const parent of seedParents) {
    const refs =
      parent.metadata?.references || parent.metadata?.cross_references || [];
    for (const ref of refs) {
      if (!ref || typeof ref !== "string") continue;
      const cleanRef = ref.trim();
      const refLower = cleanRef.toLowerCase();

      // Determine relevance:
      // A) High-value overrides: Resolutions, Restatements, Amendments, Appendices, Technical Notes
      const isOverride =
        /(resolution|restatement|amendment|appendix|annex|addendum|tn-\d+)/i.test(
          cleanRef,
        );
      // B) Question topic match: Does the question specifically cite or ask about this reference?
      const idMatch = cleanRef.match(
        /(?:figure|table|note|tn|form|resolution|appendix|section|§)\s*([a-z0-9\.\-_]+)/i,
      );
      const identifier = idMatch ? idMatch[1].toLowerCase() : refLower;
      const isCitedInQuestion =
        questionLower.includes(refLower) ||
        (identifier.length >= 2 && questionLower.includes(identifier));
      // C) Navigation / Guide reference: If the seed chunk is a Reading Guide / Table of Contents / Where to Find What,
      // or if the text surrounding the reference in the seed chunk matches terms in the question:
      const isGuideOrToc =
        parent.metadata?.is_toc ||
        /(reading guide|where to find what|table of contents|contents|document control)/i.test(
          parent.text || "",
        );
      let isRelevantGuideRef = false;
      if (isGuideOrToc) {
        const parentLines = (parent.text || "").split("\n");
        const lineWithRef = parentLines.find((l) =>
          l.toLowerCase().includes(refLower),
        );
        if (lineWithRef) {
          const lineWords = lineWithRef
            .toLowerCase()
            .split(/\W+/)
            .filter((w) => w.length >= 4);
          isRelevantGuideRef = lineWords.some((w) => questionLower.includes(w));
        }
      }
      // Skip generic figure/table mentions unless it is an override, matches the query, or is a relevant guide pointer
      if (!isOverride && !isCitedInQuestion && !isRelevantGuideRef) {
        continue;
      }

      const searchPattern = cleanRef.startsWith("§")
        ? cleanRef.slice(1).trim()
        : cleanRef;
      if (searchPattern.length >= 2) {
        referencedTargets.set(
          `${parent.documentId}:${searchPattern.toLowerCase()}`,
          {
            documentId: parent.documentId,
            searchPattern,
            originalRef: cleanRef,
            seedParentId: parent.id,
          },
        );
      }
    }
  }

  // Cap added reference chunks to configured limit
  let addedRefCount = 0;
  const MAX_REF_CHUNKS = RAG_CONFIG.MAX_REFERENCE_CHUNKS;

  for (const {
    documentId,
    searchPattern,
    originalRef,
    seedParentId,
  } of referencedTargets.values()) {
    if (result.length >= MAX_TOTAL_CHUNKS || addedRefCount >= MAX_REF_CHUNKS)
      break;

    const matched = await prismaClient.parentChunk.findMany({
      where: {
        documentId,
        document: { userId, status: "COMPLETED" },
        searchText: { contains: searchPattern, mode: "insensitive" },
      },
      include: { document: { select: { fileUrl: true, filename: true } } },
      take: 5,
    });

    // 2. Rank candidates: Prioritize true definitions over passing mentions.
    // Chunks where searchPattern is in the Heading or starts the passage rank highest.
    const contentMatched = matched.filter((c) => !c.metadata?.is_toc);

    const patternLower = searchPattern.toLowerCase();
    contentMatched.sort((a, b) => {
      const aHeading = (a.metadata?.heading_path || []).join(" ").toLowerCase();
      const bHeading = (b.metadata?.heading_path || []).join(" ").toLowerCase();
      const aInHeading = aHeading.includes(patternLower) ? 3 : 0;
      const bInHeading = bHeading.includes(patternLower) ? 3 : 0;
      const aStarts = (a.text || "")
        .trim()
        .toLowerCase()
        .startsWith(patternLower)
        ? 2
        : 0;
      const bStarts = (b.text || "")
        .trim()
        .toLowerCase()
        .startsWith(patternLower)
        ? 2
        : 0;
      return bInHeading + bStarts - (aInHeading + aStarts);
    });
    // 3. Take the top-ranked definition chunk
    for (const chunk of contentMatched.slice(0, 1)) {
      if (
        !addedIds.has(chunk.id) &&
        result.length < MAX_TOTAL_CHUNKS &&
        addedRefCount < MAX_REF_CHUNKS
      ) {
        addedIds.add(chunk.id);
        addedRefCount++;
        result.push({
          ...chunk,
          fileUrl: chunk.document?.fileUrl || null,
          documentTitle: chunk.document?.filename || null,
          retrievalOrigin: {
            type: "reference_following",
            seedParentId,
            reference: originalRef,
          },
        });
      }
    }
  }

  return result;
}
