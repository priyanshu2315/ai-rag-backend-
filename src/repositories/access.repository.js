import prisma from "../config/db.js";

// Document IDs reachable through the user's roles (each once)
export const getRoleDocumentIds = async (userId) => {
  const rows = await prisma.roleDocument.findMany({
    where: { role: { users: { some: { userId } } } },
    select: { documentId: true },
    distinct: ["documentId"],
  });
  return rows.map((row) => row.documentId);
};

export const getAllDocumentIds = async () => {
  const rows = await prisma.document.findMany({ select: { id: true } });
  return rows.map((row) => row.id);
};

export const userHasRoleDocument = async (userId, documentId) => {
  const row = await prisma.roleDocument.findFirst({
    where: { documentId, role: { users: { some: { userId } } } },
    select: { documentId: true },
  });
  return Boolean(row);
};

export const documentExists = async (documentId) => {
  const row = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true },
  });
  return Boolean(row);
};
