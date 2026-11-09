import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/db.js";
import * as authService from "../services/auth.service.js";
import * as emailService from "../services/email.service.js";

export const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser)
      return res.status(400).json({ error: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword },
    });

    res
      .status(201)
      .json({ message: "User created successfully", userId: user.id });
  } catch (error) {
    res.status(500).json({ error: "Registration failed" });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({
      where: {
        email: String(email ?? "")
          .trim()
          .toLowerCase(),
      },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!user.isActive) {
      return res.status(403).json({ error: "Account is disabled" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      token,
      userId: user.id,
      email: user.email,
      name: user.name,
      type: user.type,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const email = String(req.body?.email ?? "")
      .trim()
      .toLowerCase();
    const result = await authService.requestPasswordReset(email);
    if (result) {
      await emailService.sendPasswordResetCode({ to: email, otp: result.otp });
    }
    return res.status(200).json({
      success: true,
      message: "If the account exists, a reset code has been sent.",
      otp: result.otp,
    });
  } catch (error) {
    const status = error.message === "Email is required" ? 400 : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const result = await authService.resetPassword(email, otp, newPassword);
    return res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const status =
      error.message === "User not found"
        ? 404
        : error.message === "Invalid OTP" || error.message === "OTP expired"
          ? 400
          : error.message === "Email, otp and newPassword are required"
            ? 400
            : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await authService.changePassword(
      req.user.id,
      currentPassword,
      newPassword,
    );
    return res.status(200).json({ success: true, message: result.message });
  } catch (error) {
    const status =
      error.message === "Current password is incorrect" ? 401 : 400;
    return res.status(status).json({ success: false, error: error.message });
  }
};
