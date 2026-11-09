import * as accessRepository from "../repositories/access.repository.js";

export const isAdmin = (user) => user?.type === "ADMIN";

// All document IDs this user may see (admin: every document)
export const getAccessibleDocumentIds = async (user) => {
  if (isAdmin(user)) return accessRepository.getAllDocumentIds();
  return accessRepository.getRoleDocumentIds(user.id);
};

export const canAccessDocument = async (user, documentId) => {
  if (!documentId) return false;
  if (isAdmin(user)) return accessRepository.documentExists(documentId);
  return accessRepository.userHasRoleDocument(user.id, documentId);
};
