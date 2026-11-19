import prisma from "../config/db.js";

const documentListSelect = {
  id: true,
  filename: true,
  createdAt: true,
  fileUrl: true,
  status: true,
  summaryStatus: true,
  version: true,
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
      (SELECT COUNT(*)::int FROM "ChildChunk" c WHERE c."parentId" = p.id AND c."removedInVersion" IS NULL) AS "totalChildren"
    FROM "ParentChunk" p
    WHERE p."documentId" = ${id}
          AND p."removedInVersion" IS NULL

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
    AND "removedInVersion" IS NULL

    ORDER BY (metadata->>'child_index')::int ASC
  `;
  return children.map(({ embeddingText, ...child }) => {
    const embedding = JSON.parse(embeddingText);
    return { ...child, embedding, embeddingDimensions: embedding.length };
  });
};

export async function saveDocumentChunks(documentId, parents, units = []) {
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
      // Units point at parent chunks, so they are saved after the parents.
      // A document keeps only its current unit list.
      await tx.documentUnit.deleteMany({ where: { documentId } });
      if (units.length) {
        await tx.documentUnit.createMany({
          data: units.map((unit) => ({
            documentId,
            position: unit.position,
            kind: unit.kind,
            text: unit.text,
            hash: unit.hash,
            page: unit.page,
            parentChunkId: unit.parentChunkId ?? null,
          })),
        });
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

export const getDocumentForReplace = async (id) => {
  return prisma.document.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      fileUrl: true,
      status: true,
      fileHash: true,
      version: true,
    },
  });
};

// The document's saved sentence list, in reading order (Gate 2 compares it with the new PDF).
export const getDocumentUnits = async (documentId) => {
  return prisma.documentUnit.findMany({
    where: { documentId },
    orderBy: { position: "asc" },
    select: { position: true, kind: true, text: true, hash: true, page: true },
  });
};

// The chunks in use now (not removed), with their children, for the replace comparison.
export const getActiveChunks = async (documentId) => {
  return prisma.parentChunk.findMany({
    where: { documentId, removedInVersion: null },
    select: {
      id: true,
      text: true,
      searchText: true,
      metadata: true,
      children: {
        where: { removedInVersion: null },
        select: { id: true, text: true, searchText: true, metadata: true },
      },
    },
  });
};

// Swap a document to its new version in one transaction: until it commits, search keeps
// using the old chunks; after it, the new ones. Returns nothing; throws on any problem.
export async function saveReplacedVersion(
  documentId,
  { plan, units, version, file },
) {
  await prisma.$transaction(
    async (tx) => {
      const [current] = await tx.$queryRaw`
        SELECT id, version FROM "Document" WHERE id = ${documentId} FOR UPDATE
      `;
      if (!current) throw new Error("Document no longer exists");
      if (current.version !== version - 1)
        throw new Error("Document changed during the replace");

      // Removed chunks stay in the table (old chat traces keep valid IDs); search skips them.
      if (plan.removedParentIds.length) {
        await tx.parentChunk.updateMany({
          where: { id: { in: plan.removedParentIds } },
          data: { removedInVersion: version },
        });
      }
      if (plan.removedChildIds.length) {
        await tx.childChunk.updateMany({
          where: { id: { in: plan.removedChildIds } },
          data: { removedInVersion: version },
        });
      }

      // Kept parents: same text and ID; heading path, pages and links may have changed.
      for (const parent of plan.keptParents) {
        await tx.parentChunk.update({
          where: { id: parent.id },
          data: {
            searchText: parent.searchText,
            metadata: parent.metadata,
            prevParentId: parent.prevParentId,
            nextParentId: parent.nextParentId,
          },
        });
      }
      for (const parent of plan.addedParents) {
        await tx.parentChunk.create({
          data: {
            id: parent.id,
            documentId,
            text: parent.text,
            searchText: parent.searchText,
            prevParentId: parent.prevParentId,
            nextParentId: parent.nextParentId,
            metadata: parent.metadata,
            addedInVersion: version,
          },
        });
      }

      for (const child of plan.keptChildren) {
        if (child.reembed) {
          await tx.$executeRaw`
            UPDATE "ChildChunk"
            SET "searchText" = ${child.searchText},
                metadata = ${JSON.stringify(child.metadata)}::jsonb,
                embedding = ${child.embedding}::vector
            WHERE id = ${child.id}
          `;
        } else {
          await tx.childChunk.update({
            where: { id: child.id },
            data: { metadata: child.metadata },
          });
        }
      }
      for (const child of plan.addedChildren) {
        await tx.$executeRaw`
          INSERT INTO "ChildChunk" (
            id, text, "searchText", "parentId", "documentId", embedding, metadata, "addedInVersion"
          )
          VALUES (
            ${child.id}, ${child.text}, ${child.searchText}, ${child.parentId}, ${documentId},
            ${child.embedding}::vector, ${JSON.stringify(child.metadata)}::jsonb, ${version}
          )
        `;
      }

      await tx.documentUnit.deleteMany({ where: { documentId } });
      if (units.length) {
        await tx.documentUnit.createMany({
          data: units.map((unit) => ({
            documentId,
            position: unit.position,
            kind: unit.kind,
            text: unit.text,
            hash: unit.hash,
            page: unit.page,
            parentChunkId: unit.parentChunkId ?? null,
          })),
        });
      }

      await tx.document.update({
        where: { id: documentId },
        data: {
          filename: file.filename,
          fileUrl: file.fileUrl,
          fileHash: file.fileHash,
          version,
        },
      });
    },
    { maxWait: 10000, timeout: 120000 },
  );
}

// Chunks added and removed in one version, plus how many stayed unchanged through it.
export const getVersionChanges = async (documentId, version) => {
  const select = { id: true, text: true, metadata: true };
  const [added, removed, kept] = await Promise.all([
    prisma.parentChunk.findMany({ where: { documentId, addedInVersion: version }, select }),
    prisma.parentChunk.findMany({ where: { documentId, removedInVersion: version }, select }),
    prisma.parentChunk.count({
      where: {
        documentId,
        addedInVersion: { lt: version },
        OR: [{ removedInVersion: null }, { removedInVersion: { gt: version } }],
      },
    }),
  ]);
  return { added, removed, kept };
};
