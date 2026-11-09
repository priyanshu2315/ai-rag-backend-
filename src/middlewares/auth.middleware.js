import jwt from "jsonwebtoken";
import prisma from "../config/db.js";

export const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        type: true,
        isActive: true,
        mustChangePassword: true,
      },
    });

    if (!user || !user.isActive) {
      return res
        .status(401)
        .json({ error: "Unauthorized: Account not active" });
    }
    const path = req.originalUrl.split("?")[0];
    if (user.mustChangePassword && path !== "/api/auth/change-password") {
      return res.status(403).json({
        error: "Password change required",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      type: user.type,
    };
    next();
  } catch (error) {
    return res.status(500).json({ error: "Authentication failed" });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.type !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden: Admin only" });
  }
  next();
};
