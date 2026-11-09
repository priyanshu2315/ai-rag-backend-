import * as roleRepository from "../repositories/role.repository.js";
import { httpError } from "../utils/http.js";

const cleanName = (name) => {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) throw httpError(400, "Role name is required");
  if (value.length > 100) throw httpError(400, "Role name is too long");
  return value;
};

const cleanDocumentIds = async (documentIds = []) => {
  if (!Array.isArray(documentIds))
    throw httpError(400, "documentIds must be an array");
  const ids = [...new Set(documentIds.map(String))];
  if (
    ids.length &&
    (await roleRepository.countExistingDocuments(ids)) !== ids.length
  ) {
    throw httpError(400, "One or more documents do not exist");
  }
  return ids;
};

const mapPrismaError = (error) => {
  if (error.code === "P2002")
    return httpError(409, "A role with this name already exists");
  if (error.code === "P2025") return httpError(404, "Role not found");
  return error;
};

export const listRoles = async () => {
  const roles = await roleRepository.listRoles();
  return roles.map(({ _count, ...role }) => ({
    ...role,
    documentCount: _count.documents,
    userCount: _count.users,
  }));
};

export const getRole = async (id) => {
  const role = await roleRepository.getRoleById(id);
  if (!role) throw httpError(404, "Role not found");
  return {
    ...role,
    documents: role.documents.map(({ document, addedAt }) => ({
      ...document,
      addedAt,
    })),
    users: role.users.map(({ user, assignedAt }) => ({ ...user, assignedAt })),
  };
};

export const createRole = async ({ name, description, documentIds }) => {
  try {
    const ids = await cleanDocumentIds(documentIds);
    const role = await roleRepository.createRole(
      cleanName(name),
      description?.trim() || null,
      ids,
    );
    return getRole(role.id);
  } catch (error) {
    throw mapPrismaError(error);
  }
};

export const updateRole = async (id, { name, description }) => {
  const data = {};
  if (name !== undefined) data.name = cleanName(name);
  if (description !== undefined) data.description = description?.trim() || null;
  if (!Object.keys(data).length) throw httpError(400, "Nothing to update");
  try {
    await roleRepository.updateRole(id, data);
    return getRole(id);
  } catch (error) {
    throw mapPrismaError(error);
  }
};

export const deleteRole = async (id) => {
  try {
    await roleRepository.deleteRole(id);
  } catch (error) {
    throw mapPrismaError(error);
  }
};

export const setRoleDocuments = async (id, documentIds) => {
  if (!(await roleRepository.getRoleById(id)))
    throw httpError(404, "Role not found");
  const ids = await cleanDocumentIds(documentIds);
  await roleRepository.setRoleDocuments(id, ids);
  return getRole(id);
};
