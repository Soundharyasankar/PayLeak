import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

export interface AuthenticatedRequest extends Request {
  auth: { userId: string; email: string };
}

function getAccessToken(req: Request) {
  const authorization = req.header("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);

  const cookieHeader = req.header("cookie");
  const cookie = cookieHeader?.split(";").map((item) => item.trim())
    .find((item) => item.startsWith("payleak_access="));
  return cookie?.slice("payleak_access=".length);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = getAccessToken(req);
  if (!token) {
    next(new AppError(401, "Authentication is required.", "AUTH_REQUIRED"));
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.email !== "string") {
      throw new Error("Invalid token claims");
    }
    (req as AuthenticatedRequest).auth = { userId: payload.sub, email: payload.email };
    next();
  } catch {
    next(new AppError(401, "The access token is invalid or expired.", "INVALID_TOKEN"));
  }
}

export function getUserId(req: Request) {
  const authenticated = req as AuthenticatedRequest;
  if (!authenticated.auth?.userId) throw new AppError(401, "Authentication is required.", "AUTH_REQUIRED");
  return authenticated.auth.userId;
}
