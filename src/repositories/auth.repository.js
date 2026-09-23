import prisma from "../config/db.js";

export const findUserByEmail = async (email) => {
  return await prisma.user.findUnique({ where: { email } });
};

export const setResetOtp = async (userId, otp, expiresAt) => {
  return await prisma.user.update({
    where: { id: userId },
    data: { resetOtp: otp, resetOtpExpiresAt: expiresAt },
  });
};

export const clearResetOtp = async (userId) => {
  return await prisma.user.update({
    where: { id: userId },
    data: { resetOtp: null, resetOtpExpiresAt: null },
  });
};

export const updatePassword = async (userId, hashedPassword) => {
  return await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });
};
