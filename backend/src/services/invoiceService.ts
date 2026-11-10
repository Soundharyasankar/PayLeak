import { Types } from "mongoose";
import { Decimal } from "decimal.js";
import { Client } from "../models/Client.js";
import { Invoice } from "../models/Invoice.js";
import { AppError } from "../utils/errors.js";
import { ensureAssistantInvoiceIndex } from "./invoiceIndexService.js";
import { createPaypalInvoice, publishLocalInvoiceToPaypal, sendPaypalInvoice, updatePaypalInvoiceDraft } from "./paypalInvoiceService.js";
import { calculateInvoiceLineItemTotal, type InvoiceLineItem } from "../utils/invoiceLineItems.js";

export async function listInvoices(userId: string) {
  const invoices = await Invoice.find({ userId }).sort({ createdAt: -1 }).lean();
  return invoices.map(toFrontendInvoice);
}

export async function createInvoice(userId: string, input: {
  clientId?: string; client: string; email: string; project?: string; services?: string[];
  lineItems?: InvoiceLineItem[]; amount: string; currency: string; description: string; date: Date; due: Date;
}, requestId: string) {
  let clientId: Types.ObjectId | null = null;
  if (input.clientId) {
    const client = await Client.findOne({ _id: input.clientId, userId });
    if (!client) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
    clientId = client._id;
  }
  const amount = input.lineItems ? calculateInvoiceLineItemTotal(input.lineItems, input.currency) : input.amount;
  const invoice = await createPaypalInvoice(userId, {
    ...input,
    amount,
    clientId: clientId ? String(clientId) : undefined,
  }, requestId);
  return toFrontendInvoice(invoice);
}

export async function createLocalInvoiceDraft(userId: string, input: {
  assistantSessionId: string; clientId?: string; client: string; email: string; project?: string; services?: string[];
  lineItems?: InvoiceLineItem[]; amount: string; currency: string; description: string; date: Date; due: Date;
}) {
  let clientId: Types.ObjectId | null = null;
  if (input.clientId) {
    const client = await Client.findOne({ _id: input.clientId, userId });
    if (!client) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
    clientId = client._id;
  }
  const amount = input.lineItems ? calculateInvoiceLineItemTotal(input.lineItems, input.currency) : input.amount;
  const { assistantSessionId, date, due, ...fields } = input;
  fields.amount = amount;
  await ensureAssistantInvoiceIndex();
  const invoice = await Invoice.findOneAndUpdate(
    { userId, assistantSessionId },
    {
      $setOnInsert: {
        ...fields,
        userId,
        clientId,
        assistantSessionId,
        invoiceDate: date,
        dueDate: due,
        status: "Draft",
        source: "payleak",
      },
    },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  if (!invoice) throw new AppError(500, "Could not save the PayLeak invoice draft.", "INVOICE_DRAFT_PERSIST_FAILED");
  return toFrontendInvoice(invoice);
}

export async function publishInvoiceToPaypal(userId: string, id: string, requestId: string) {
  return toFrontendInvoice(await publishLocalInvoiceToPaypal(userId, id, requestId));
}

export async function getInvoice(userId: string, id: string) {
  const invoice = await Invoice.findOne({ _id: id, userId }).lean();
  if (!invoice) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  return toFrontendInvoice(invoice);
}

export function invoiceUpdateMode(invoice: {
  source: string;
  status: string;
  paypalRequestId?: string | null;
}): "local" | "paypal" {
  if (invoice.status !== "Draft") {
    throw new AppError(409, "Only invoice drafts can be edited.", "INVOICE_NOT_EDITABLE");
  }
  if (invoice.source === "paypal") return "paypal";
  if (invoice.source === "payleak") return "local";
  throw new AppError(409, "This invoice source cannot be edited.", "INVOICE_NOT_EDITABLE");
}

export function synchronizeItemizedDescription(
  description: string,
  project: string,
  previousItems: ReadonlyArray<{ description: string }>,
  nextItems: ReadonlyArray<{ description: string }>,
) {
  const lines = description.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const previousDescriptions = new Set(previousItems.map(({ description: value }) => value.trim().toLocaleLowerCase()));
  const nextDescriptions = new Set(nextItems.map(({ description: value }) => value.trim().toLocaleLowerCase()));
  const projectDescription = project.trim();
  const projectKey = projectDescription.toLocaleLowerCase();
  const generatedFromItems = lines.every((line) =>
    line.toLocaleLowerCase() === projectKey || previousDescriptions.has(line.toLocaleLowerCase()));

  if (generatedFromItems) {
    return [projectDescription, ...nextItems.map(({ description: value }) => value.trim())]
      .filter(Boolean)
      .join("\n");
  }

  return lines
    .filter((line) => !previousDescriptions.has(line.toLocaleLowerCase())
      || nextDescriptions.has(line.toLocaleLowerCase()))
    .join("\n");
}

export async function updateInvoice(userId: string, id: string, input: Partial<{
  clientId: string; client: string; email: string; project: string; services: string[];
  lineItems: InvoiceLineItem[]; amount: string; currency: string; description: string; date: Date; due: Date;
}>) {
  const existing = await Invoice.findOne({ _id: id, userId }).select(
    "source status clientId client email project services lineItems amount currency description invoiceDate dueDate",
  );
  if (!existing) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  const updateMode = invoiceUpdateMode(existing);
  const fields: Record<string, unknown> = { ...input };
  if (input.lineItems) {
    const currency = input.currency ?? existing.currency;
    const total = calculateInvoiceLineItemTotal(input.lineItems, currency);
    fields.amount = total;
    fields.services = input.lineItems.map(({ description }) => description);
    fields.description = synchronizeItemizedDescription(
      input.description ?? existing.description,
      input.project ?? existing.project,
      existing.lineItems,
      input.lineItems,
    );
  } else if (input.amount && existing.lineItems.length > 0 && !new Decimal(input.amount).eq(existing.amount)) {
    throw new AppError(422, "Update the line item amounts instead of changing an itemized invoice total directly.", "INVOICE_LINE_ITEMS_REQUIRED");
  }
  if (input.date) fields.invoiceDate = input.date;
  if (input.due) fields.dueDate = input.due;
  delete fields.date;
  delete fields.due;
  if (input.clientId) {
    const client = await Client.findOne({ _id: input.clientId, userId });
    if (!client) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
    fields.clientId = client._id;
  }
  if (updateMode === "paypal") {
    return toFrontendInvoice(await updatePaypalInvoiceDraft(userId, id, {
      ...(existing.clientId ? { clientId: String(existing.clientId) } : {}),
      client: typeof fields.client === "string" ? fields.client : existing.client,
      email: typeof fields.email === "string" ? fields.email : existing.email,
      project: typeof fields.project === "string" ? fields.project : existing.project,
      services: Array.isArray(fields.services) ? fields.services as string[] : existing.services,
      lineItems: Array.isArray(fields.lineItems) ? fields.lineItems as InvoiceLineItem[] : existing.lineItems,
      amount: typeof fields.amount === "string" ? fields.amount : existing.amount,
      currency: typeof fields.currency === "string" ? fields.currency : existing.currency,
      description: typeof fields.description === "string" ? fields.description : existing.description,
      date: fields.invoiceDate instanceof Date ? fields.invoiceDate : existing.invoiceDate,
      due: fields.dueDate instanceof Date ? fields.dueDate : existing.dueDate ?? existing.invoiceDate,
    }));
  }
  const invoice = await Invoice.findOneAndUpdate(
    { _id: id, userId, source: "payleak", status: "Draft" },
    { $set: fields, $unset: { paypalRequestId: 1 } },
    { new: true, runValidators: true },
  ).lean();
  if (!invoice) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  return toFrontendInvoice(invoice);
}

export function assertDeletableLocalInvoiceDraft(invoice: {
  source: string;
  status: string;
  paypalInvoiceId?: string | null;
  paypalRequestId?: string | null;
}) {
  if (invoice.status !== "Draft") {
    throw new AppError(
      409,
      "Only unsent invoice drafts can be deleted. Sent, paid, and other finalized invoices remain in your records.",
      "INVOICE_NOT_DELETABLE",
    );
  }
  if (invoice.source !== "payleak" || invoice.paypalInvoiceId) {
    throw new AppError(
      409,
      "This invoice is linked to PayPal and cannot be deleted from PayLeak. Use PayPal's cancellation workflow if needed.",
      "PAYPAL_INVOICE_NOT_DELETABLE",
    );
  }
}

export async function deleteInvoice(userId: string, id: string) {
  const deleted = await Invoice.findOneAndDelete({
    _id: id,
    userId,
    source: "payleak",
    status: "Draft",
    $or: [{ paypalInvoiceId: { $exists: false } }, { paypalInvoiceId: null }, { paypalInvoiceId: "" }],
  }).lean();
  if (deleted) return;

  const existing = await Invoice.findOne({ _id: id, userId })
    .select("source status paypalInvoiceId")
    .lean();
  if (!existing) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  assertDeletableLocalInvoiceDraft(existing);
  throw new AppError(409, "This invoice changed and can no longer be deleted.", "INVOICE_NOT_DELETABLE");
}

export async function sendInvoice(userId: string, id: string) {
  return toFrontendInvoice(await sendPaypalInvoice(userId, id));
}

function toFrontendInvoice(invoice: {
  _id: unknown; client: string; email: string; project?: string; services?: string[]; amount: string; currency: string; description: string;
  lineItems?: InvoiceLineItem[];
  invoiceDate: Date; dueDate?: Date | null; status: string; paypalInvoiceId?: string | null;
  invoiceNumber?: string | null; customerEmail?: string | null; customerName?: string | null;
  subtotal?: string | null; tax?: string | null; totalAmount?: string | null; paymentAmount?: string | null;
  paymentDate?: Date | null; invoiceUrl?: string | null; source?: string;
  paypalStatus?: string | null; paypalLastSyncedAt?: Date | null;
}) {
  const id = String(invoice._id);
  let status = invoice.status;
  if ((status === "Sent" || status === "Partially Paid") && invoice.dueDate) {
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const dueUtc = new Date(invoice.dueDate);
    dueUtc.setUTCHours(0, 0, 0, 0);
    if (dueUtc.getTime() < todayUtc.getTime()) status = "Overdue";
  }
  return {
    id,
    invoiceNumber: invoice.invoiceNumber ?? id,
    client: invoice.customerName || invoice.client || "Unknown customer",
    email: invoice.customerEmail || invoice.email || "",
    project: invoice.project ?? "",
    services: invoice.services ?? [],
    lineItems: invoice.lineItems ?? [],
    amount: invoice.totalAmount ?? invoice.amount,
    currency: invoice.currency,
    description: invoice.description,
    date: invoice.invoiceDate.toISOString().slice(0, 10),
    due: invoice.dueDate?.toISOString().slice(0, 10) ?? null,
    status,
    subtotal: invoice.subtotal,
    tax: invoice.tax,
    paymentAmount: invoice.paymentAmount,
    paymentDate: invoice.paymentDate?.toISOString().slice(0, 10) ?? null,
    invoiceUrl: invoice.invoiceUrl,
    paypalId: invoice.paypalInvoiceId,
    source: invoice.source ?? "payleak",
    paypalStatus: invoice.paypalStatus ?? null,
    paypalLastSyncedAt: invoice.paypalLastSyncedAt?.toISOString() ?? null,
  };
}
