import prisma from "../config/db.js";

export const listRoles = () =>
  prisma.role.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { documents: true, users: true } },
    },
    orderBy: { name: "asc" },
  });

export const getRoleById = (id) =>
  prisma.role.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      documents: {
        select: {
          addedAt: true,
          document: { select: { id: true, filename: true, status: true } },
        },
      },
      users: {
        select: {
          assignedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

export const createRole = (name, description, documentIds) =>
  prisma.role.create({
    data: {
      name,
      description,
      documents: { create: documentIds.map((documentId) => ({ documentId })) },
    },
    select: { id: true },
  });

export const updateRole = (id, data) =>
  prisma.role.update({ where: { id }, data, select: { id: true } });

export const deleteRole = (id) => prisma.role.delete({ where: { id } });

// Remove documents no longer selected, add new ones, keep the rest (keeps their addedAt)
export const setRoleDocuments = (roleId, documentIds) =>
  prisma.$transaction([
    prisma.roleDocument.deleteMany({
      where: { roleId, documentId: { notIn: documentIds } },
    }),
    prisma.roleDocument.createMany({
      data: documentIds.map((documentId) => ({ roleId, documentId })),
      skipDuplicates: true,
    }),
  ]);

export const countExistingDocuments = (ids) =>
  prisma.document.count({ where: { id: { in: ids } } });
