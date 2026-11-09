import * as userService from "../services/user.service.js";
import { handle } from "../utils/http.js";

export const listUsers = handle((req) =>
  userService.listUsers(req.query.search),
);
export const getUser = handle((req) => userService.getUser(req.params.userId));
export const createUser = handle(
  (req) => userService.createUser(req.body ?? {}),
  201,
);
export const updateUser = handle((req) =>
  userService.updateUser(req.user, req.params.userId, req.body ?? {}),
);
export const setUserRoles = handle((req) =>
  userService.setUserRoles(req.params.userId, req.body?.roleIds),
);
export const resetUserPassword = handle((req) =>
  userService.resetUserPassword(req.params.userId, req.body?.temporaryPassword),
);
