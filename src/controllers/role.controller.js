import * as roleService from "../services/role.service.js";
import { handle } from "../utils/http.js";

export const listRoles = handle(() => roleService.listRoles());
export const getRole = handle((req) => roleService.getRole(req.params.roleId));
export const createRole = handle(
  (req) => roleService.createRole(req.body ?? {}),
  201,
);
export const updateRole = handle((req) =>
  roleService.updateRole(req.params.roleId, req.body ?? {}),
);
export const deleteRole = handle(async (req) => {
  await roleService.deleteRole(req.params.roleId);
  return { success: true };
});
export const setRoleDocuments = handle((req) =>
  roleService.setRoleDocuments(req.params.roleId, req.body?.documentIds),
);
