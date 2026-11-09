import prisma from "../config/db.js";

// Never select the password
const userSelect = {
  id: true,
  name: true,
  email: true,
  type: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
  roles: {
    select: { assignedAt: true, role: { select: { id: true, name: true } } },
  },
};

export const listUsers = (search) =>
  prisma.user.findMany({
    where: search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    select: userSelect,
    orderBy: { createdAt: "desc" },
  });

export const getUserById = (id) =>
  prisma.user.findUnique({ where: { id }, select: userSelect });

export const createUser = ({ name, email, password, type, roleIds }) =>
  prisma.user.create({
    data: {
      name,
      email,
      password,
      type,
      mustChangePassword: true,
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
    },
    select: { id: true },
  });

export const updateUser = (id, data) =>
  prisma.user.update({ where: { id }, data, select: { id: true } });

// Remove roles no longer selected, add new ones, keep the rest
export const setUserRoles = (userId, roleIds) =>
  prisma.$transaction([
    prisma.userRole.deleteMany({
      where: { userId, roleId: { notIn: roleIds } },
    }),
    prisma.userRole.createMany({
      data: roleIds.map((roleId) => ({ userId, roleId })),
      skipDuplicates: true,
    }),
  ]);

export const countExistingRoles = (ids) =>
  prisma.role.count({ where: { id: { in: ids } } });
