import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
import { dashboardAnalytics, leakAnalytics, monthlyAnalytics, clientAnalytics, currencyAnalytics } from "../services/analyticsService.js";
import { transactionBreakdown } from "../services/transactionService.js";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { rateLimitExceeded } from "../utils/response.js";
import { analyzeOwnedTransaction } from "../services/transactionAnalysisService.js";

export const analyticsRoutes = Router();
analyticsRoutes.use(requireAuth);
const transactionAnalysisLimit = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceeded,
});
analyticsRoutes.get("/", asyncHandler(async (req, res) => success(res, await dashboardAnalytics(getUserId(req)))));
analyticsRoutes.get("/dashboard", asyncHandler(async (req, res) => success(res, await dashboardAnalytics(getUserId(req)))));
analyticsRoutes.get("/monthly", asyncHandler(async (req, res) => success(res, await monthlyAnalytics(getUserId(req)))));
analyticsRoutes.get("/fees", asyncHandler(async (req, res) => success(res, (await leakAnalytics(getUserId(req))).actualFeesByCurrency)));
analyticsRoutes.get("/clients", asyncHandler(async (req, res) => success(res, await clientAnalytics(getUserId(req)))));
analyticsRoutes.get("/currencies", asyncHandler(async (req, res) => success(res, await currencyAnalytics(getUserId(req)))));
analyticsRoutes.get("/leaks", asyncHandler(async (req, res) => success(res, await leakAnalytics(getUserId(req)))));
analyticsRoutes.get("/leaks/:transactionId", asyncHandler(async (req, res) =>
  success(res, await transactionBreakdown(getUserId(req), z.string().min(1).max(160).parse(req.params.transactionId)))));
analyticsRoutes.get("/transactions/:transactionId/ai-analysis", transactionAnalysisLimit, asyncHandler(async (req, res) => {
  const transactionId = z.string().min(1).max(160).parse(req.params.transactionId);
  const query = z.object({ regenerate: z.enum(["true", "false"]).optional() }).parse(req.query);
  return success(res, await analyzeOwnedTransaction(getUserId(req), transactionId, query.regenerate === "true"));
}));
