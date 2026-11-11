import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.ts";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { rateLimitExceeded, success } from "../utils/response.ts";
import { createInvoice, createLocalInvoiceDraft, deleteInvoice, getInvoice, listInvoices, publishInvoiceToPaypal, sendInvoice, updateInvoice } from "../services/invoiceService.js";
import { invoiceBody, invoiceFields, validateInvoiceAmountPrecision } from "../validators/invoice.js";
import { invoiceAssistantRequestSchema } from "../validators/invoiceAssistant.js";
import { idParam } from "../validators/common.js";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { diagnosePaypalInvoiceAccess, syncPaypalInvoices } from "../services/paypalInvoiceService.js";
import { AppError } from "../utils/errors.js";
import { paypalInvoiceCurrencies } from "../config/paypalCurrencies.js";
import { understandInvoiceTurn } from "../services/invoiceAssistantService.js";

const invoicePatch = invoiceFields.extend({
  project: z.string().trim().max(160).optional(),
  services: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
}).partial().superRefine(validateInvoiceAmountPrecision);
const idempotencyKey = z.string().uuid();
const localDraftBody = invoiceFields.extend({
  project: z.string().trim().max(160).optional(),
  services: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  assistantSessionId: idempotencyKey,
}).superRefine(validateInvoiceAmountPrecision).refine((value) => value.due >= value.date, {
  message: "Due date must be on or after the invoice date.",
  path: ["due"],
});
const invoiceAssistantLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitExceeded,
});
export const invoiceRoutes = Router();
invoiceRoutes.use(requireAuth);

invoiceRoutes.post("/assistant", invoiceAssistantLimit, validateBody(invoiceAssistantRequestSchema), asyncHandler(async (req, res) =>
  success(res, await understandInvoiceTurn(req.body.message, req.body.draft, req.body.history))));
invoiceRoutes.get("/currencies", asyncHandler(async (_req, res) => success(res, {
  currencies: Object.entries(paypalInvoiceCurrencies).map(([code, details]) => ({
    code,
    ...details,
    symbol: new Intl.NumberFormat("en", { style: "currency", currency: code })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? code,
  })),
  accountAvailability: "These are ISO currencies recognized by the server runtime. PayPal confirms invoicing and merchant availability when the invoice is created.",
})));
invoiceRoutes.get("/", asyncHandler(async (req, res) => success(res, await listInvoices(getUserId(req)))));
invoiceRoutes.post("/local-draft", validateBody(localDraftBody), asyncHandler(async (req, res) =>
  success(res, await createLocalInvoiceDraft(getUserId(req), req.body), 201)));
invoiceRoutes.post("/", validateBody(invoiceBody), asyncHandler(async (req, res) => {
  const requestId = idempotencyKey.parse(req.header("Idempotency-Key"));
  return success(res, await createInvoice(getUserId(req), req.body, requestId), 201);
}));
invoiceRoutes.post("/paypal/diagnostics", asyncHandler(async (req, res) => {
  const diagnostic = await diagnosePaypalInvoiceAccess(getUserId(req));
  return success(res, {
    invoiceApiAccess: diagnostic.invoiceApiAccess === "authorized" ? "authorized" : "unavailable",
  });
}));
invoiceRoutes.post("/sync-paypal", asyncHandler(async (req, res) => {
  try {
    await syncPaypalInvoices(getUserId(req));
    return success(res, { synchronized: true });
  } catch (error) {
    console.error("PayPal invoice synchronization failed", {
      code: error instanceof AppError ? error.code : "UNEXPECTED_ERROR",
      diagnostic: error instanceof AppError ? error.diagnostic : undefined,
    });
    throw new AppError(502, "Unable to synchronize PayPal invoices. Please try again.", "PAYPAL_INVOICE_SYNC_FAILED");
  }
}));
invoiceRoutes.post("/:id/paypal", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const requestId = idempotencyKey.parse(req.header("Idempotency-Key"));
  return success(res, await publishInvoiceToPaypal(getUserId(req), id, requestId), 201);
}));
invoiceRoutes.get("/:id", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  return success(res, await getInvoice(getUserId(req), id));
}));
invoiceRoutes.put("/:id", validateBody(invoicePatch), asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  return success(res, await updateInvoice(getUserId(req), id, req.body));
}));
invoiceRoutes.delete("/:id", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  await deleteInvoice(getUserId(req), id);
  return res.status(204).end();
}));
invoiceRoutes.post("/:id/send", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  return success(res, await sendInvoice(getUserId(req), id));
}));
