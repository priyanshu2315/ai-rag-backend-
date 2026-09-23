import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/db.js';
import * as authService from '../services/auth.service.js';

export const register = async (req, res) => {
  try {
    const { email, password } = req.body;
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword },
    });

    res.status(201).json({ message: 'User created successfully', userId: user.id });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed' });
  }
};


export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user.id, email: user.email });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const { otp } = await authService.requestPasswordReset(email);
    return res.status(200).json({ success: true, otp });
  } catch (error) {
    const status =
      error.message === 'User not found'
        ? 404
        : error.message === 'Email is required'
          ? 400
          : 500;
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
      error.message === 'User not found'
        ? 404
        : error.message === 'Invalid OTP' || error.message === 'OTP expired'
          ? 400
          : error.message === 'Email, otp and newPassword are required'
            ? 400
            : 500;
    return res.status(status).json({ success: false, error: error.message });
  }
};
