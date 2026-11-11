import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.ts";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.ts";
import { z } from "zod";
import { syncBody, transactionQuery } from "../validators/transactions.js";
import { getTransaction, listTransactions, transactionBreakdown } from "../services/transactionService.ts";
import { refreshPaypalTransaction, syncPaypalTransactions } from "../services/paypalService.ts";
import { AppError } from "../utils/errors.js";
import { createNotification } from "../services/notificationService.ts";

export const transactionRoutes = Router();
transactionRoutes.use(requireAuth);

transactionRoutes.get("/", validateQuery(transactionQuery), asyncHandler(async (req, res) => {
  const query = transactionQuery.parse(req.query);
  return success(res, await listTransactions(getUserId(req), query));
}));

transactionRoutes.post("/sync", validateBody(syncBody), asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  let result: Awaited<ReturnType<typeof syncPaypalTransactions>>;
  try {
    result = await syncPaypalTransactions(userId, req.body.startDate, req.body.endDate);
  } catch (error) {
    if (!(error instanceof AppError)) console.error("PayPal transaction synchronization failed.", error);
    throw new AppError(502, "Unable to synchronize PayPal transactions. Please try again.", "PAYPAL_SYNC_FAILED");
  }
  await createNotification({
    userId, category: "Sync", title: "PayPal transactions synchronised",
    body: "PayPal transactions synchronized successfully.",
    dedupeKey: `transaction-sync:${result.lastSyncedAt.toISOString().slice(0, 13)}`,
  });
  return success(res, { synchronized: true });
}));

transactionRoutes.post("/:id/refresh", asyncHandler(async (req, res) => {
  const id = z.string().min(1).max(160).parse(req.params.id);
  try {
    return success(res, await refreshPaypalTransaction(getUserId(req), id));
  } catch (error) {
    if (error instanceof AppError && (error.details || error.diagnostic)) {
      throw new AppError(502, "Unable to refresh this PayPal transaction. Please try again.", "PAYPAL_TRANSACTION_REFRESH_FAILED");
    }
    throw error;
  }
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
