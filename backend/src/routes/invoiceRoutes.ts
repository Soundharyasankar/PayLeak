import { randomUUID } from "node:crypto";
import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
import { AppError } from "../utils/errors.js";
import { Invoice } from "../models/Invoice.js";
import { createInvoice, deleteInvoice, getInvoice, listInvoices, publishInvoiceToPaypal, sendInvoice, updateInvoice } from "../services/invoiceService.js";
import { invoiceBody, invoiceFields, validateInvoiceAmountPrecision } from "../validators/invoice.js";
import { idParam } from "../validators/common.js";
import { z } from "zod";
import { diagnosePaypalInvoiceAccess, syncPaypalInvoices } from "../services/paypalInvoiceService.js";

const invoicePatch = invoiceFields.partial().superRefine(validateInvoiceAmountPrecision);
const idempotencyKey = z.string().uuid();
export const invoiceRoutes = Router();
invoiceRoutes.use(requireAuth);

invoiceRoutes.get("/", asyncHandler(async (req, res) => success(res, await listInvoices(getUserId(req)))));
invoiceRoutes.post("/", validateBody(invoiceBody), asyncHandler(async (req, res) => {
  const rawKey = req.header("Idempotency-Key");
  const parsedKey = idempotencyKey.safeParse(rawKey);
  const requestId = parsedKey.success ? parsedKey.data : randomUUID();
  return success(res, await createInvoice(getUserId(req), req.body, requestId), 201);
}));
invoiceRoutes.post("/paypal/diagnostics", asyncHandler(async (req, res) =>
  success(res, await diagnosePaypalInvoiceAccess(getUserId(req)))));
invoiceRoutes.post("/sync-paypal", asyncHandler(async (req, res) =>
  success(res, await syncPaypalInvoices(getUserId(req)))));
invoiceRoutes.post("/:id/paypal", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  const rawKey = req.header("Idempotency-Key");
  const parsedKey = idempotencyKey.safeParse(rawKey);
  const requestId = parsedKey.success ? parsedKey.data : randomUUID();
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
  const invoice = await Invoice.findOne({ _id: id, userId: getUserId(req) }).select("status");
  if (!invoice) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  if (invoice.status === "Paid") throw new AppError(409, "Paid invoices cannot be deleted.", "INVOICE_ALREADY_PAID");
  await deleteInvoice(getUserId(req), id);
  return res.status(204).end();
}));
invoiceRoutes.post("/:id/send", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  return success(res, await sendInvoice(getUserId(req), id));
}));
