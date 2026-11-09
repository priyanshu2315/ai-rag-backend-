import bcrypt from "bcryptjs";
import * as userRepository from "../repositories/user.repository.js";
import { httpError } from "../utils/http.js";
import * as emailService from "./email.service.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_TYPES = ["ADMIN", "USER"];

const toUser = ({ roles, ...user }) => ({
  ...user,
  roles: roles.map(({ role, assignedAt }) => ({ ...role, assignedAt })),
});

const cleanName = (name) => {
  const value = typeof name === "string" ? name.trim() : "";
  if (!value) throw httpError(400, "Name is required");
  if (value.length > 100) throw httpError(400, "Name is too long");
  return value;
};

const cleanEmail = (email) => {
  const value = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!EMAIL_PATTERN.test(value))
    throw httpError(400, "A valid email is required");
  return value;
};

const cleanPassword = (password) => {
  if (typeof password !== "string" || password.length < 8) {
    throw httpError(400, "Temporary password must be at least 8 characters");
  }
  return password;
};

const cleanType = (type) => {
  if (!USER_TYPES.includes(type))
    throw httpError(400, "type must be ADMIN or USER");
  return type;
};

const cleanRoleIds = async (roleIds = []) => {
  if (!Array.isArray(roleIds)) throw httpError(400, "roleIds must be an array");
  const ids = [...new Set(roleIds.map(String))];
  if (
    ids.length &&
    (await userRepository.countExistingRoles(ids)) !== ids.length
  ) {
    throw httpError(400, "One or more roles do not exist");
  }
  return ids;
};

const mapPrismaError = (error) => {
  if (error.code === "P2002")
    return httpError(409, "A user with this email already exists");
  if (error.code === "P2025") return httpError(404, "User not found");
  return error;
};

export const listUsers = async (search) => {
  const users = await userRepository.listUsers(search?.trim() || undefined);
  return users.map(toUser);
};

export const getUser = async (id) => {
  const user = await userRepository.getUserById(id);
  if (!user) throw httpError(404, "User not found");
  return toUser(user);
};

export const createUser = async ({
  name,
  email,
  temporaryPassword,
  type = "USER",
  roleIds,
}) => {
  let user;
  try {
    const data = {
      name: cleanName(name),
      email: cleanEmail(email),
      type: cleanType(type),
      roleIds: await cleanRoleIds(roleIds),
      password: await bcrypt.hash(cleanPassword(temporaryPassword), 10),
    };
    user = await getUser((await userRepository.createUser(data)).id);
  } catch (error) {
    throw mapPrismaError(error);
  }

  const emailSent = await emailService.sendWelcomeEmail({
    to: user.email,
    name: user.name,
    temporaryPassword,
  });
  return { ...user, emailSent };
};

export const updateUser = async (currentUser, id, { name, type, isActive }) => {
  const data = {};
  if (name !== undefined) data.name = cleanName(name);
  if (type !== undefined) data.type = cleanType(type);
  if (isActive !== undefined) {
    if (typeof isActive !== "boolean")
      throw httpError(400, "isActive must be true or false");
    data.isActive = isActive;
  }
  if (!Object.keys(data).length) throw httpError(400, "Nothing to update");
  if (
    id === currentUser.id &&
    (data.isActive === false || data.type === "USER")
  ) {
    throw httpError(400, "You cannot disable or demote your own account");
  }
  try {
    await userRepository.updateUser(id, data);
    return getUser(id);
  } catch (error) {
    throw mapPrismaError(error);
  }
};

export const setUserRoles = async (id, roleIds) => {
  if (!(await userRepository.getUserById(id)))
    throw httpError(404, "User not found");
  await userRepository.setUserRoles(id, await cleanRoleIds(roleIds));
  return getUser(id);
};

export const resetUserPassword = async (id, temporaryPassword) => {
  const password = await bcrypt.hash(cleanPassword(temporaryPassword), 10);
  try {
    await userRepository.updateUser(id, { password, mustChangePassword: true });
  } catch (error) {
    throw mapPrismaError(error);
  }
  const user = await getUser(id);
  const emailSent = await emailService.sendTemporaryPasswordEmail({
    to: user.email,
    name: user.name,
    temporaryPassword,
  });
  return { ...user, emailSent };
};
