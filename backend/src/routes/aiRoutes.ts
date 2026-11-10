import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { rateLimitExceeded, success } from "../utils/response.js";
import { diagnoseGemini, explainFinancialData } from "../services/aiService.js";
import { answerFinancialAgent, createClientFinancialReport, downloadFinancialReport, getDatePeriod } from "../services/clientFinancialService.js";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";

const questionBody = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().min(1).max(4000),
  }).strict()).max(12).optional(),
}).strict();
const financialAgentBody = questionBody.extend({
  contextClientId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  selectedClientId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
}).strict();
const clientReportBody = z.object({
  clientId: z.string().regex(/^[a-f\d]{24}$/i),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
}).strict();
export const aiRoutes = Router();
aiRoutes.use(requireAuth);
const financialAgentLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceeded,
});
aiRoutes.post(["/chat", "/assistant"], validateBody(questionBody), asyncHandler(async (req, res) =>
  success(res, await explainFinancialData(getUserId(req), req.body.question, req.body.history ?? []))));
aiRoutes.post("/financial-agent", financialAgentLimit, validateBody(financialAgentBody), asyncHandler(async (req, res) =>
  success(res, await answerFinancialAgent(
    getUserId(req),
    req.body.question,
    req.body.contextClientId,
    getDatePeriod(req.body.periodStart, req.body.periodEnd),
    req.body.selectedClientId,
  ))));
aiRoutes.post("/reports/client", financialAgentLimit, validateBody(clientReportBody), asyncHandler(async (req, res) =>
  success(res, await createClientFinancialReport(
    getUserId(req),
    req.body.clientId,
    getDatePeriod(req.body.periodStart, req.body.periodEnd),
  ), 201)));
aiRoutes.get("/reports/:reportId/download", financialAgentLimit, asyncHandler(async (req, res) => {
  const report = await downloadFinancialReport(getUserId(req), z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.reportId));
  res.setHeader("Content-Type", report.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${report.fileName.replace(/["\\\r\n]/g, "")}"`);
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).send(report.pdf);
}));
aiRoutes.post("/diagnostics", asyncHandler(async (_req, res) =>
  success(res, await diagnoseGemini())));
