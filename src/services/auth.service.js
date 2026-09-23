import bcrypt from "bcryptjs";
import * as authRepository from "../repositories/auth.repository.js";

const OTP_TTL_MS = 10 * 60 * 1000;

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

export const requestPasswordReset = async (email) => {
  if (!email) {
    throw new Error("Email is required");
  }

  const user = await authRepository.findUserByEmail(email);
  if (!user) {
    throw new Error("User not found");
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await authRepository.setResetOtp(user.id, otp, expiresAt);

  return { otp, expiresAt };
};

export const resetPassword = async (email, otp, newPassword) => {
  if (!email || !otp || !newPassword) {
    throw new Error("Email, otp and newPassword are required");
  }

  const user = await authRepository.findUserByEmail(email);
  if (!user) {
    throw new Error("User not found");
  }

  if (!user.resetOtp || user.resetOtp !== otp) {
    throw new Error("Invalid OTP");
  }

  if (!user.resetOtpExpiresAt || user.resetOtpExpiresAt < new Date()) {
    throw new Error("OTP expired");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await authRepository.updatePassword(user.id, hashedPassword);
  await authRepository.clearResetOtp(user.id);

  return { message: "Password reset successful" };
};
