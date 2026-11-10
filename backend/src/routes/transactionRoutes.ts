import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
import { z } from "zod";
import { syncBody, transactionQuery } from "../validators/transactions.js";
import { getTransaction, listTransactions, transactionBreakdown } from "../services/transactionService.js";
import { refreshPaypalTransaction, syncPaypalTransactions } from "../services/paypalService.js";
import { AppError } from "../utils/errors.js";
import { createNotification } from "../services/notificationService.js";

export const transactionRoutes = Router();
transactionRoutes.use(requireAuth);

transactionRoutes.get("/", validateQuery(transactionQuery), asyncHandler(async (req, res) => {
  const query = transactionQuery.parse(req.query);
  return success(res, await listTransactions(getUserId(req), query));
}));

transactionRoutes.post("/sync", validateBody(syncBody), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const result = await syncPaypalTransactions(userId, req.body.startDate, req.body.endDate);
  await createNotification({
    userId, category: "Sync", title: "PayPal transactions synchronised",
    body: `${result.paypalTotalRecordsRetrieved} PayPal transaction records were retrieved; ${result.totalRecordsInserted} were newly added to PayLeak.`,
    dedupeKey: `transaction-sync:${result.lastSyncedAt.toISOString().slice(0, 13)}`,
  });
  return success(res, result);
}));

transactionRoutes.post("/:id/refresh", asyncHandler(async (req, res) => {
  const id = z.string().min(1).max(160).parse(req.params.id);
  return success(res, await refreshPaypalTransaction(getUserId(req), id));
}));

transactionRoutes.get("/:id", asyncHandler(async (req, res) => {
  const id = z.string().min(1).max(160).parse(req.params.id);
  const transaction = await getTransaction(getUserId(req), id);
  return success(res, transaction);
}));

transactionRoutes.get("/:id/fee-breakdown", asyncHandler(async (req, res) => {
  const id = z.string().min(1).max(160).parse(req.params.id);
  const breakdown = await transactionBreakdown(getUserId(req), id);
  if (!breakdown.transactionFee.value) throw new AppError(404, "Actual PayPal fee data is unavailable for this transaction.", "FEE_UNAVAILABLE");
  return success(res, breakdown);
}));

transactionRoutes.get("/:id/currency-breakdown", asyncHandler(async (req, res) => {
  const id = z.string().min(1).max(160).parse(req.params.id);
  return success(res, await transactionBreakdown(getUserId(req), id));
}));
