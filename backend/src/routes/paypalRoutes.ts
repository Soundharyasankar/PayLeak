import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { requireAuth, getUserId } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError } from "../utils/errors.js";
import { rateLimitExceeded, success } from "../utils/response.js";
import { connectConfiguredMerchant, diagnosePaypalAccess, getPaypalAccount, syncPaypalTransactions } from "../services/paypalService.js";
import { verifyAndStoreWebhook } from "../services/webhookService.js";
import { syncBody } from "../validators/transactions.js";
import { z } from "zod";
import { cancelSandboxOrder, captureSandboxOrder, createSandboxOrder } from "../services/paypalCheckoutService.js";

const webhookLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, handler: rateLimitExceeded });
const checkoutLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, handler: rateLimitExceeded });
const webhookBody = z.object({ id: z.string().min(1), event_type: z.string().min(1), resource: z.record(z.string(), z.unknown()).optional() }).passthrough();
const checkoutBody = z.object({
  amount: z.string().trim().regex(/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/),
  description: z.string().trim().min(1).max(127),
}).strict();
const paypalOrderId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

export const paypalRoutes = Router();
paypalRoutes.use(requireAuth);
paypalRoutes.get("/config", asyncHandler(async (_req, res) => success(res, {
  mode: env.PAYPAL_MODE,
  checkoutConfigured: env.PAYPAL_MODE === "sandbox" && Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
  merchantConsentAvailable: true,
})));
paypalRoutes.get("/connect", asyncHandler(async (req, res) => success(res, await connectConfiguredMerchant(getUserId(req)))));
paypalRoutes.post("/connect", asyncHandler(async (req, res) => success(res, await connectConfiguredMerchant(getUserId(req)))));
paypalRoutes.get("/account", asyncHandler(async (req, res) => success(res, await getPaypalAccount(getUserId(req)))));
paypalRoutes.post("/diagnostics", checkoutLimit, asyncHandler(async (req, res) =>
  success(res, await diagnosePaypalAccess(getUserId(req)))));
paypalRoutes.post("/sync", validateBody(syncBody), asyncHandler(async (req, res) =>
  success(res, await syncPaypalTransactions(getUserId(req), req.body.startDate, req.body.endDate))));
paypalRoutes.post("/orders", checkoutLimit, asyncHandler(async (req, res) => {
  const input = checkoutBody.parse(req.body);
  const idempotencyKey = z.string().uuid().safeParse(req.header("Idempotency-Key"));
  if (!idempotencyKey.success) throw new AppError(400, "A valid Idempotency-Key UUID header is required.", "IDEMPOTENCY_KEY_REQUIRED");
  return success(res, await createSandboxOrder(getUserId(req), { ...input, currency: input.currency.toUpperCase(), idempotencyKey: idempotencyKey.data }), 201);
}));
paypalRoutes.post("/orders/:orderId/capture", checkoutLimit, asyncHandler(async (req, res) => {
  const id = paypalOrderId.parse(req.params.orderId);
  return success(res, await captureSandboxOrder(getUserId(req), id));
}));
paypalRoutes.post("/orders/:orderId/cancel", checkoutLimit, asyncHandler(async (req, res) => {
  const id = paypalOrderId.parse(req.params.orderId);
  return success(res, await cancelSandboxOrder(getUserId(req), id));
}));

export const paypalWebhookRoutes = Router();
paypalWebhookRoutes.post("/webhook", webhookLimit, asyncHandler(async (req, res) => {
  const parsed = webhookBody.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "Invalid PayPal webhook event.", "INVALID_WEBHOOK", parsed.error.flatten());
  if (!env.PAYPAL_WEBHOOK_ID) throw new AppError(503, "PayPal webhook verification is not configured.", "PAYPAL_WEBHOOK_UNAVAILABLE");
  const headers = {
    "paypal-transmission-id": req.header("paypal-transmission-id"),
    "paypal-transmission-time": req.header("paypal-transmission-time"),
    "paypal-transmission-sig": req.header("paypal-transmission-sig"),
    "paypal-cert-url": req.header("paypal-cert-url"),
    "paypal-auth-algo": req.header("paypal-auth-algo"),
  };
  return success(res, await verifyAndStoreWebhook(headers, parsed.data), 202);
}));
