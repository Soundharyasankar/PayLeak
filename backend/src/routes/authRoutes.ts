import { Router } from "express";
import { User } from "../models/User.ts";
import { requireAuth, getUserId } from "../middleware/authMiddleware.ts";
import { validateBody } from "../middleware/validate.js";
import { registerBody, loginBody } from "../validators/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { rateLimitExceeded, success } from "../utils/response.ts";
import { loginUser, registerUser } from "../services/authService.js";
import { AppError } from "../utils/errors.js";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";

export const authRoutes = Router();
const loginRegisterLimit = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false, handler: rateLimitExceeded });
const accessCookieName = "payleak_access";
const partitionedAccessCookieName = "__Host-payleak_access";
const isProduction = process.env.NODE_ENV === "production";
const accessCookieSameSite = process.env.NODE_ENV === "production" ? "none" as const : "lax" as const;
const profileBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
}).strict();
const accessCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: accessCookieSameSite,
  path: "/",
  maxAge: 8 * 60 * 60 * 1000,
};
const partitionedAccessCookieOptions = {
  ...accessCookieOptions,
  partitioned: true,
};
const accessCookieClearOptions = {
  httpOnly: true,
  secure: accessCookieOptions.secure,
  sameSite: accessCookieSameSite,
  path: "/",
};

function setAccessCookies(res: import("express").Response, accessToken: string) {
  if (isProduction) {
    res.clearCookie(accessCookieName, accessCookieClearOptions);
    res.cookie(partitionedAccessCookieName, accessToken, partitionedAccessCookieOptions);
    return;
  }
  res.cookie(accessCookieName, accessToken, accessCookieOptions);
}

authRoutes.post("/register", loginRegisterLimit, validateBody(registerBody), asyncHandler(async (req, res) => {
  const result = await registerUser(req.body);
  setAccessCookies(res, result.accessToken);
  return success(res, { user: result.user }, 201);
}));

authRoutes.post("/login", loginRegisterLimit, validateBody(loginBody), asyncHandler(async (req, res) => {
  const result = await loginUser(req.body);
  setAccessCookies(res, result.accessToken);
  return success(res, { user: result.user });
}));

authRoutes.get("/me", requireAuth, asyncHandler(async (req, res) => {
  const user = await User.findById(getUserId(req)).select("name email").lean();
  if (!user) throw new AppError(404, "User not found.", "USER_NOT_FOUND");
  return success(res, { id: String(user._id), name: user.name, email: user.email });
}));

authRoutes.put("/me", requireAuth, asyncHandler(async (req, res) => {
  const input = profileBody.parse(req.body);
  const userId = getUserId(req);
  const email = input.email.trim().toLowerCase();
  if (await User.exists({ email, _id: { $ne: userId } })) {
    throw new AppError(409, "An account with this email already exists.", "EMAIL_IN_USE");
  }
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { name: input.name.trim(), email } },
    { new: true, runValidators: true },
  ).select("name email").lean();
  if (!user) throw new AppError(404, "User not found.", "USER_NOT_FOUND");
  return success(res, { id: String(user._id), name: user.name, email: user.email });
}));

authRoutes.post("/logout", (_req, res) => {
  res.clearCookie(accessCookieName, accessCookieClearOptions);
  if (isProduction) {
    res.clearCookie(partitionedAccessCookieName, {
      ...accessCookieClearOptions,
      partitioned: true,
    });
  }
  return res.status(204).end();
});
