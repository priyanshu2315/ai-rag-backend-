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
      p.id,
      p.text,
      p."searchText",
      p."documentId",
      p."prevParentId",
      p."nextParentId",
      p.metadata,
      (SELECT COUNT(*)::int FROM "ChildChunk" c WHERE c."parentId" = p.id) AS "totalChildren"
    FROM "ParentChunk" p
    WHERE p."documentId" = ${id}
    ORDER BY (p.metadata->>'chunk_index')::int ASC
  `;
};

export const getParentChunkById = async (parentId, userId) => {
  return await prisma.parentChunk.findFirst({
    where: { id: parentId, document: { userId } },
    select: {
      id: true,
      text: true,
      searchText: true,
      prevParentId: true,
      nextParentId: true,
      documentId: true,
      metadata: true,
    },
  });
};

export const getChildChunksByParentId = async (parentId) => {
  const children = await prisma.$queryRaw`
    SELECT id, text, "searchText", "parentId", "documentId", metadata,
      embedding::text AS "embeddingText"
    FROM "ChildChunk"
    WHERE "parentId" = ${parentId}
    ORDER BY (metadata->>'child_index')::int ASC
  `;
  return children.map(({ embeddingText, ...child }) => {
    const embedding = JSON.parse(embeddingText);
    return { ...child, embedding, embeddingDimensions: embedding.length };
  });
};

export async function saveDocumentChunks(documentId, parents) {
  await prisma.$transaction(
    async (tx) => {
      // Prevent two replacements for this document from
      // changing its chunks at the same time.
      const documents = await tx.$queryRaw`
        SELECT id
        FROM "Document"
        WHERE id = ${documentId}
        FOR UPDATE
      `;

      if (documents.length === 0) {
        throw new Error("Document no longer exists");
      }

      for (const parent of parents) {
        await tx.parentChunk.create({
          data: {
            id: parent.id,
            documentId,

            text: parent.text,
            searchText: parent.searchText,

            prevParentId: parent.prevParentId,
            nextParentId: parent.nextParentId,

            metadata: parent.metadata,
          },
        });

        for (const child of parent.children) {
          await tx.$executeRaw`
            INSERT INTO "ChildChunk" (
              id,
              text,
              "searchText",
              "parentId",
              "documentId",
              embedding,
              metadata
            )
            VALUES (
              ${child.id},
              ${child.text},
              ${child.searchText},
              ${parent.id},
              ${documentId},
              ${child.embedding}::vector,
              ${JSON.stringify(child.metadata)}::jsonb
            )
          `;
        }
      }
    },
    {
      maxWait: 10000,
      timeout: 120000,
    },
  );
}
