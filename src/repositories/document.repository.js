import prisma from "../config/db.js";

const documentListSelect = {
  id: true,
  filename: true,
  createdAt: true,
  fileUrl: true,
  status: true,
  summaryStatus: true,
};

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
    select: documentListSelect,
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

export const getDocumentById = async (id) => {
  return await prisma.document.findUnique({
    where: { id },
  });
};

export const getDocumentForDelete = async (id) => {
  return prisma.document.findUnique({
    where: { id },
    select: { id: true, userId: true, fileUrl: true, status: true },
  });
};

export const deleteDocumentById = async (id) => {
  // Existing foreign keys cascade to parents, children, role links, conversations and messages.
  return prisma.document.deleteMany({
    where: { id, status: { in: ["COMPLETED", "FAILED"] } },
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
    where: { id: parentId },
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

export const getDocumentsByIds = async (ids) => {
  return await prisma.document.findMany({
    where: { id: { in: ids } },
    select: documentListSelect,
    orderBy: { createdAt: "desc" },
  });
};
