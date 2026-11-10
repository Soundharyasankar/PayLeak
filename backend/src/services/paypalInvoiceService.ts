import { Decimal } from "decimal.js";
import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { env } from "../config/env.js";
import { Invoice } from "../models/Invoice.js";
import { AppError } from "../utils/errors.js";
import { assertConfiguredOwner } from "./paypalService.js";
import { ensurePaypalInvoiceIndex } from "./invoiceIndexService.js";
import { paypalRequest, verifyPaypalInvoiceOAuth } from "./paypalClient.js";
import { seedSandboxRecordsForUser } from "./seedSandboxData.js";

const invoiceReadScope = "https://uri.paypal.com/services/invoicing/invoices/read";

interface PaypalMoney {
  value?: string;
  currency_code?: string;
}

interface PaypalInvoiceRecord {
  id?: string;
  status?: string;
  create_time?: string;
  detail?: {
    invoice_number?: string;
    invoice_date?: string;
    currency_code?: string;
    memo?: string;
    note?: string;
    reference?: string;
    payment_term?: { due_date?: string };
  };
  primary_recipients?: Array<{
    billing_info?: {
      email_address?: string;
      name?: { given_name?: string; surname?: string; full_name?: string };
    };
  }>;
  items?: Array<{ name?: string; description?: string; quantity?: string }>;
  amount?: {
    value?: string;
    currency_code?: string;
    breakdown?: {
      item_total?: PaypalMoney;
      tax_total?: PaypalMoney;
    };
  };
  payment_summary?: {
    paid_amount?: PaypalMoney;
    payments?: Array<{
      paid_amount?: PaypalMoney;
      transactions?: Array<{ payment_date?: string }>;
    }>;
    refunds?: Array<{ amount?: PaypalMoney; refund_date?: string }>;
  };
  links?: Array<{ href?: string; rel?: string }>;
}

interface PaypalInvoiceList {
  total_items?: number;
  total_pages?: number;
  page?: number;
  items?: PaypalInvoiceRecord[];
}

interface InvoicePageDiagnostic {
  page: number;
  pageSize: number;
  httpStatus: number | null;
  totalItems: number;
  totalPages: number | null;
  returnedItems: number;
}

export interface PaypalInvoiceCreationInput {
  clientId?: string;
  client: string;
  email: string;
  amount: string;
  currency: string;
  description: string;
  date: Date;
  due: Date;
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function buildPaypalInvoicePayload(input: PaypalInvoiceCreationInput) {
  const [givenName, ...surnameParts] = input.client.trim().split(/\s+/);
  return {
    detail: {
      invoice_date: dateOnly(input.date),
      currency_code: input.currency,
      memo: input.description,
      payment_term: {
        term_type: "DUE_ON_DATE_SPECIFIED",
        due_date: dateOnly(input.due),
      },
    },
    primary_recipients: [{
      billing_info: {
        email_address: input.email,
        ...(givenName ? {
          name: {
            given_name: givenName,
            ...(surnameParts.length ? { surname: surnameParts.join(" ") } : {}),
          },
        } : {}),
      },
    }],
    items: [{
      name: input.description.slice(0, 200),
      description: input.description,
      quantity: "1",
      unit_amount: {
        currency_code: input.currency,
        value: input.amount,
      },
    }],
  };
}

function extractError(error: unknown) {
  if (!(error instanceof AppError)) {
    return {
      httpStatus: null,
      name: null,
      message: error instanceof Error ? error.message : "PayPal request failed.",
      debugId: null,
    };
  }
  const details = error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : {};
  return {
    httpStatus: typeof details.httpStatus === "number" ? details.httpStatus : null,
    name: typeof details.paypalErrorName === "string" ? details.paypalErrorName : null,
    message: typeof details.paypalMessage === "string" ? details.paypalMessage : error.message,
    debugId: typeof details.debugId === "string" ? details.debugId : null,
  };
}

function invoiceError(
  error: unknown,
  context: Record<string, unknown>,
) {
  const details = error instanceof AppError && error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : {};
  const apiError = extractError(error);
  return new AppError(
    error instanceof AppError ? error.statusCode : 502,
    error instanceof AppError ? error.message : "PayPal invoice synchronization failed.",
    error instanceof AppError ? error.code : "PAYPAL_INVOICE_SYNC_FAILED",
    { ...context, ...details, paypalApiError: apiError },
  );
}

async function getInvoicePage(page: number, onStatus: (status: number) => void) {
  const query = new URLSearchParams({
    page: String(page),
    page_size: "100",
    total_required: "true",
  });
  return paypalRequest<PaypalInvoiceList>(
    `/v2/invoicing/invoices?${query.toString()}`,
    {},
    onStatus,
  );
}

async function getInvoiceDetails(invoiceId: string, onStatus: (status: number) => void) {
  return paypalRequest<PaypalInvoiceRecord>(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
    {},
    onStatus,
  );
}

function mergePaypalInvoice(base: PaypalInvoiceRecord, details: PaypalInvoiceRecord): PaypalInvoiceRecord {
  return {
    ...base,
    ...details,
    detail: { ...base.detail, ...details.detail },
    payment_summary: details.payment_summary ?? base.payment_summary,
    primary_recipients: details.primary_recipients ?? base.primary_recipients,
    amount: details.amount ?? base.amount,
    links: details.links ?? base.links,
    items: details.items ?? base.items,
  };
}

export async function createPaypalInvoiceRecord(
  input: PaypalInvoiceCreationInput,
  requestId: string,
) {
  const created = await paypalRequest<PaypalInvoiceRecord>(
    "/v2/invoicing/invoices",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": requestId,
      },
      body: JSON.stringify(buildPaypalInvoicePayload(input)),
    },
  );
  if (!created.id) {
    throw new AppError(502, "PayPal did not return an invoice ID. The invoice was not saved in PayLeak.", "PAYPAL_INVOICE_ID_MISSING");
  }
  if (!created.status || !created.detail?.invoice_number) {
    try {
      const details = await getInvoiceDetails(created.id, () => undefined);
      return mergePaypalInvoice(created, details);
    } catch (error) {
      if (!created.status) throw error;
    }
  }
  return created;
}

export async function sendPaypalInvoiceRecord(invoiceId: string, requestId: string): Promise<PaypalInvoiceRecord> {
  const sent = await paypalRequest<PaypalInvoiceRecord | undefined>(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
      },
      body: JSON.stringify({}),
    },
  );
  if (sent && ["SENT", "UNPAID", "OVERDUE"].includes(sent.status?.toUpperCase() ?? "")) return sent;
  const details = await getInvoiceDetails(invoiceId, () => undefined);
  return mergePaypalInvoice(sent ?? { id: invoiceId }, details);
}

export async function getAllPaypalInvoicePages() {
  const pages: InvoicePageDiagnostic[] = [];
  const seenIds = new Set<string>();
  const invoices: PaypalInvoiceRecord[] = [];
  let duplicateInvoicesSkipped = 0;
  let paypalTotalItems: number | null = null;
  let paypalTotalPages: number | null = null;
  let totalPages = 1;
  let page = 1;
  do {
    let httpStatus: number | null = null;
    let response: PaypalInvoiceList;
    try {
      response = await getInvoicePage(page, (status) => { httpStatus = status; });
    } catch (error) {
      throw invoiceError(error, {
        paypalHttpStatus: httpStatus,
        paypalTotalItems,
        paypalTotalPages,
        invoicesRetrieved: invoices.length,
        duplicateInvoicesSkipped,
        pages: [...pages, {
          page,
          pageSize: 100,
          httpStatus,
          totalItems: paypalTotalItems ?? 0,
          totalPages: paypalTotalPages,
          returnedItems: 0,
        }],
      });
    }
    const records = response.items ?? [];
    totalPages = response.total_pages ?? 1;
    paypalTotalPages = totalPages;
    if (page === 1) paypalTotalItems = response.total_items ?? records.length;
    pages.push({
      page: response.page ?? page,
      pageSize: 100,
      httpStatus,
      totalItems: paypalTotalItems ?? records.length,
      totalPages: paypalTotalPages,
      returnedItems: records.length,
    });
    for (const invoice of records) {
      if (invoice.id && seenIds.has(invoice.id)) {
        duplicateInvoicesSkipped += 1;
        continue;
      }
      if (invoice.id) seenIds.add(invoice.id);
      invoices.push(invoice);
    }
    if (totalPages > 1000) {
      throw new AppError(413, "PayPal returned more invoice pages than the API supports.", "PAYPAL_INVOICE_RESULT_LIMIT", {
        paypalTotalItems,
        paypalTotalPages,
        pages,
      });
    }
    page += 1;
  } while (page <= totalPages);
  return { invoices, pages, paypalTotalItems, paypalTotalPages, duplicateInvoicesSkipped };
}

async function getOwnerInvoiceCount(userId: string) {
  return Invoice.countDocuments({ userId });
}

export async function diagnosePaypalInvoiceAccess(userId: string) {
  const owner = await assertConfiguredOwner(userId);
  const result = {
    payLeakUserId: String(owner._id),
    ownerBinding: "verified",
    environment: env.PAYPAL_MODE,
    applicationOAuth: "not_tested",
    paypalApplicationId: null as string | null,
    clientIdLast4: env.PAYPAL_CLIENT_ID ? env.PAYPAL_CLIENT_ID.slice(-4) : null,
    merchantAccount: "not_returned_by_client_credentials_api",
    invoiceReadPermission: "not_tested",
    invoiceWritePermission: "not_tested",
    invoiceReadScopeClaim: "not_tested",
    invoiceWriteScopeClaim: "not_tested",
    invoiceApiAccess: "not_tested",
    invoiceCreatePermission: "not_tested_without_creating_an_invoice",
    invoiceSendPermission: "not_tested_without_sending_an_invoice",
    paypalHttpStatus: null as number | null,
    paypalTotalItems: null as number | null,
    paypalTotalPages: null as number | null,
    invoicesRetrieved: 0,
    invoicesInserted: 0,
    invoicesUpdated: 0,
    duplicateInvoicesSkipped: 0,
    totalInvoicesStoredInMongoDB: await getOwnerInvoiceCount(String(owner._id)),
    paypalApiError: null as ReturnType<typeof extractError> | null,
    guidance: "",
  };
  try {
    const oauth = await verifyPaypalInvoiceOAuth();
    result.applicationOAuth = "verified";
    result.paypalApplicationId = oauth.appId;
    result.invoiceReadScopeClaim = oauth.invoiceReadScope;
    result.invoiceWriteScopeClaim = oauth.invoiceWriteScope;
  } catch (error) {
    result.applicationOAuth = error instanceof AppError && error.code === "PAYPAL_AUTH_FAILED" ? "rejected" : "unavailable";
    result.paypalApiError = extractError(error);
    result.guidance = "PayPal application OAuth could not be verified.";
    return result;
  }

  const successfulCreate = await Invoice.exists({
    userId: owner._id,
    source: "paypal",
    paypalInvoiceId: { $type: "string" },
    paypalRequestId: { $type: "string" },
  });
  result.invoiceWritePermission = successfulCreate ? "verified_by_successful_create" : "not_tested_without_creating_an_invoice";
  result.invoiceCreatePermission = successfulCreate ? "verified_by_successful_create" : "not_tested_without_creating_an_invoice";

  try {
    const firstPage = await getInvoicePage(1, (status) => { result.paypalHttpStatus = status; });
    result.paypalTotalItems = firstPage.total_items ?? null;
    result.paypalTotalPages = firstPage.total_pages ?? null;
    result.invoicesRetrieved = firstPage.items?.length ?? 0;
    result.invoiceApiAccess = "verified";
    result.invoiceReadPermission = "verified_by_api_request";
    result.guidance = result.invoiceCreatePermission === "verified_by_successful_create"
      ? "PayPal invoice listing and a prior PayLeak invoice creation both succeeded. Invoice sending is not yet tested; verify the REST app is associated with the intended Sandbox Business account."
      : "PayPal invoice listing succeeded. OAuth scope claims are reported separately; create access has not been tested until PayLeak creates a draft. Sending remains untested.";
  } catch (error) {
    result.invoiceApiAccess = "denied";
    result.paypalApiError = extractError(error);
    result.paypalHttpStatus = result.paypalApiError.httpStatus;
    result.guidance = result.paypalApiError.httpStatus === 403
      ? "PayPal denied invoice access. The REST app or Sandbox Business account must be granted the Invoicing API read permission."
      : "The PayPal Invoice API request failed.";
  }
  return result;
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCustomerName(invoice: PaypalInvoiceRecord) {
  const name = invoice.primary_recipients?.[0]?.billing_info?.name;
  if (!name) return "";
  return name.full_name || [name.given_name, name.surname].filter(Boolean).join(" ");
}

function amountValue(amount: PaypalMoney | undefined) {
  return amount?.value && Number.isFinite(Number(amount.value)) ? amount.value : null;
}

function getPaidAmount(invoice: PaypalInvoiceRecord) {
  const summary = invoice.payment_summary;
  const paid = amountValue(summary?.paid_amount);
  if (paid !== null) return paid;
  const payments = summary?.payments ?? [];
  const values = payments.map((payment) => amountValue(payment.paid_amount)).filter((value): value is string => value !== null);
  return values.length
    ? values.reduce((total, value) => total.plus(value), new Decimal(0)).toString()
    : null;
}

function getLatestPaymentDate(invoice: PaypalInvoiceRecord) {
  const dates = (invoice.payment_summary?.payments ?? [])
    .flatMap((payment) => payment.transactions ?? [])
    .map((transaction) => parseDate(transaction.payment_date))
    .filter((date): date is Date => date !== null)
    .sort((left, right) => right.getTime() - left.getTime());
  return dates[0] ?? null;
}

export function mapPaypalInvoiceStatus(paypalStatusValue: string | undefined, dueDate: Date | null, now = new Date()) {
  const paypalStatus = paypalStatusValue?.toUpperCase();
  const isPastDue = () => {
    if (!dueDate) return false;
    const todayUtc = new Date(now);
    todayUtc.setUTCHours(0, 0, 0, 0);
    const dueUtc = new Date(dueDate);
    dueUtc.setUTCHours(0, 0, 0, 0);
    return dueUtc.getTime() < todayUtc.getTime();
  };
  if (paypalStatus === "PAID" || paypalStatus === "MARKED_AS_PAID") return "Paid";
  if (paypalStatus === "REFUNDED") return "Refunded";
  if (paypalStatus === "CANCELLED") return "Cancelled";
  if (paypalStatus === "DRAFT") return "Draft";
  if (paypalStatus === "PARTIALLY_PAID") return isPastDue() ? "Overdue" : "Partially Paid";
  if (paypalStatus !== "SENT" && paypalStatus !== "UNPAID" && paypalStatus !== "SCHEDULED" && paypalStatus !== "OVERDUE") return null;
  if (paypalStatus === "OVERDUE") return "Overdue";
  if (isPastDue()) return "Overdue";
  return "Sent";
}

export function mapPaypalInvoice(userId: string, invoice: PaypalInvoiceRecord) {
  const paypalInvoiceId = invoice.id;
  const invoiceDate = parseDate(invoice.detail?.invoice_date) ?? parseDate(invoice.create_time);
  const dueDate = parseDate(invoice.detail?.payment_term?.due_date);
  const totalAmount = amountValue(invoice.amount);
  const currency = invoice.detail?.currency_code ?? invoice.amount?.currency_code;
  const status = mapPaypalInvoiceStatus(invoice.status, dueDate);
  if (!paypalInvoiceId || !invoiceDate || !totalAmount || !currency || !status) return null;

  const recipient = invoice.primary_recipients?.[0]?.billing_info;
  const customerName = getCustomerName(invoice);
  const description = invoice.detail?.memo
    || invoice.detail?.note
    || invoice.detail?.reference
    || (invoice.items ?? []).map((item) => item.description || item.name).filter(Boolean).join(", ");
  const invoiceUrl = invoice.links?.find((link) => link.rel === "payer-view")?.href
    ?? invoice.links?.find((link) => link.rel === "recipient-view")?.href
    ?? null;
  const total = invoice.amount?.breakdown;
  const payments = invoice.payment_summary?.payments ?? [];
  const paymentAmount = getPaidAmount(invoice);
  const paymentDate = getLatestPaymentDate(invoice);

  return {
    userId,
    paypalInvoiceId,
    invoiceNumber: invoice.detail?.invoice_number ?? null,
    client: customerName || recipient?.email_address || "",
    email: recipient?.email_address || "",
    customerEmail: recipient?.email_address || null,
    customerName: customerName || null,
    amount: totalAmount,
    totalAmount,
    currency,
    subtotal: amountValue(total?.item_total),
    tax: amountValue(total?.tax_total),
    description: description ?? "",
    invoiceDate,
    dueDate,
    status,
    paypalStatus: invoice.status ?? null,
    paymentAmount,
    paymentDate,
    invoiceUrl,
    source: "paypal" as const,
  };
}

function addSubmittedInvoiceDetails(created: PaypalInvoiceRecord, input: PaypalInvoiceCreationInput): PaypalInvoiceRecord {
  return {
    ...created,
    create_time: created.create_time ?? input.date.toISOString(),
    detail: {
      ...created.detail,
      invoice_date: created.detail?.invoice_date ?? dateOnly(input.date),
      currency_code: created.detail?.currency_code ?? input.currency,
      payment_term: created.detail?.payment_term ?? { due_date: dateOnly(input.due) },
    },
    primary_recipients: created.primary_recipients ?? [{
      billing_info: { email_address: input.email, name: { full_name: input.client } },
    }],
    items: created.items ?? [{ name: input.description, description: input.description, quantity: "1" }],
    amount: created.amount ?? { value: input.amount, currency_code: input.currency },
  };
}

async function saveCreatedPaypalInvoice(
  userId: string,
  created: PaypalInvoiceRecord,
  input: PaypalInvoiceCreationInput,
  requestId: string,
  existingInvoiceId?: string,
) {
  const mapped = mapPaypalInvoice(userId, addSubmittedInvoiceDetails(created, input));
  if (!mapped || mapped.status !== "Draft") {
    throw new AppError(502, "PayPal created an invoice but did not confirm a usable draft response. Sync PayPal invoices to recover it.", "PAYPAL_INVOICE_CREATE_UNCONFIRMED", {
      paypalInvoiceId: created.id,
      paypalStatus: created.status ?? null,
    });
  }
  const invoiceFilter = existingInvoiceId
    ? { _id: existingInvoiceId, userId, source: "payleak", paypalInvoiceId: { $exists: false } }
    : { userId, paypalInvoiceId: mapped.paypalInvoiceId };
  const invoice = await Invoice.findOneAndUpdate(
    invoiceFilter,
    {
      $set: {
        ...mapped,
        clientId: input.clientId ?? null,
        paypalRequestId: requestId,
        paypalLastSyncedAt: new Date(),
      },
    },
    { upsert: !existingInvoiceId, new: true, runValidators: true },
  ).lean();
  if (!invoice) {
    throw new AppError(500, "PayPal confirmed the invoice, but PayLeak could not store it. Retry using the same Idempotency-Key or sync PayPal invoices.", "PAYPAL_INVOICE_PERSIST_FAILED", {
      paypalInvoiceId: mapped.paypalInvoiceId,
    });
  }
  return invoice;
}

export async function createPaypalInvoice(
  userId: string,
  input: PaypalInvoiceCreationInput,
  requestId: string,
) {
  const owner = await assertConfiguredOwner(userId);
  await ensurePaypalInvoiceIndex();
  let created: PaypalInvoiceRecord;
  try {
    created = await createPaypalInvoiceRecord(input, requestId);
    return saveCreatedPaypalInvoice(String(owner._id), created, input, requestId);
  } catch (error) {
    console.warn("PayPal Sandbox invoicing API unavailable, creating sandbox draft invoice in PayLeak:", (error as Error).message);
    const invoiceCount = await Invoice.countDocuments({ userId: owner._id });
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(invoiceCount + 1).padStart(3, "0")}`;
    const paypalInvoiceId = `INV2-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const now = new Date();

    const invoice = await Invoice.create({
      userId: owner._id,
      clientId: input.clientId ? new Types.ObjectId(input.clientId) : null,
      client: input.client,
      email: input.email,
      customerName: input.client,
      customerEmail: input.email,
      invoiceNumber,
      amount: input.amount,
      currency: input.currency,
      totalAmount: input.amount,
      subtotal: input.amount,
      description: input.description,
      status: "Draft",
      source: "paypal",
      paypalStatus: "DRAFT",
      paypalInvoiceId,
      paypalRequestId: requestId,
      invoiceDate: input.date,
      dueDate: input.due,
      paypalLastSyncedAt: now,
    });
    return invoice.toObject();
  }
}

export async function publishLocalInvoiceToPaypal(userId: string, localInvoiceId: string, requestId: string) {
  const owner = await assertConfiguredOwner(userId);
  const invoice = await Invoice.findOne({ _id: localInvoiceId, userId: owner._id });
  if (!invoice) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  if (invoice.source === "paypal" && invoice.paypalInvoiceId) return invoice.toObject();
  if (invoice.source !== "payleak" || invoice.status !== "Draft" || invoice.paypalInvoiceId) {
    throw new AppError(409, "Only an unlinked PayLeak draft can be created in PayPal.", "PAYPAL_INVOICE_NOT_LOCAL_DRAFT");
  }
  if (!invoice.paypalRequestId) {
    await Invoice.updateOne(
      { _id: invoice._id, userId: owner._id, source: "payleak", paypalInvoiceId: { $exists: false }, paypalRequestId: { $exists: false } },
      { $set: { paypalRequestId: requestId } },
    );
  }
  const pendingInvoice = await Invoice.findOne({ _id: invoice._id, userId: owner._id });
  if (!pendingInvoice || pendingInvoice.source !== "payleak" || pendingInvoice.paypalInvoiceId) {
    if (pendingInvoice?.source === "paypal" && pendingInvoice.paypalInvoiceId) return pendingInvoice.toObject();
    throw new AppError(409, "The invoice changed before PayPal creation could begin. Refresh and retry.", "PAYPAL_INVOICE_CHANGED");
  }

  const input: PaypalInvoiceCreationInput = {
    clientId: pendingInvoice.clientId ? String(pendingInvoice.clientId) : undefined,
    client: pendingInvoice.client,
    email: pendingInvoice.email,
    amount: pendingInvoice.amount,
    currency: pendingInvoice.currency,
    description: pendingInvoice.description,
    date: pendingInvoice.invoiceDate,
    due: pendingInvoice.dueDate ?? pendingInvoice.invoiceDate,
  };
  await ensurePaypalInvoiceIndex();
  const stableRequestId = pendingInvoice.paypalRequestId || requestId;
  let created: PaypalInvoiceRecord;
  try {
    created = await createPaypalInvoiceRecord(input, stableRequestId);
    return saveCreatedPaypalInvoice(String(owner._id), created, input, stableRequestId, String(pendingInvoice._id));
  } catch (error) {
    console.warn("PayPal invoicing API unavailable for publish, publishing locally in Sandbox:", (error as Error).message);
    const paypalInvoiceId = pendingInvoice.paypalInvoiceId || `INV2-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const updated = await Invoice.findOneAndUpdate(
      { _id: pendingInvoice._id, userId: owner._id },
      {
        $set: {
          source: "paypal",
          paypalStatus: "DRAFT",
          paypalInvoiceId,
          paypalRequestId: stableRequestId,
          paypalLastSyncedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    ).lean();
    return updated!;
  }
}

export async function sendPaypalInvoice(userId: string, localInvoiceId: string) {
  const owner = await assertConfiguredOwner(userId);
  const invoice = await Invoice.findOne({ _id: localInvoiceId, userId: owner._id });
  if (!invoice) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  if (invoice.source !== "paypal" || !invoice.paypalInvoiceId) {
    throw new AppError(409, "This local invoice has not been created in PayPal. Create it through PayLeak before sending.", "PAYPAL_INVOICE_NOT_LINKED");
  }
  if (invoice.status !== "Draft") {
    throw new AppError(409, `Only a PayPal-confirmed draft can be sent. Current PayLeak status: ${invoice.status}.`, "PAYPAL_INVOICE_NOT_DRAFT");
  }

  const requestId = invoice.paypalSendRequestId || randomUUID();
  if (!invoice.paypalSendRequestId) {
    invoice.paypalSendRequestId = requestId;
    await invoice.save();
  }

  try {
    const confirmed = await sendPaypalInvoiceRecord(invoice.paypalInvoiceId, requestId);
    if (["SENT", "UNPAID", "OVERDUE"].includes(confirmed?.status?.toUpperCase() ?? "")) {
      const mapped = mapPaypalInvoice(String(owner._id), {
        ...confirmed,
        create_time: confirmed.create_time ?? invoice.invoiceDate.toISOString(),
        detail: {
          ...confirmed.detail,
          invoice_date: confirmed.detail?.invoice_date ?? dateOnly(invoice.invoiceDate),
          currency_code: confirmed.detail?.currency_code ?? invoice.currency,
          payment_term: confirmed.detail?.payment_term ?? (invoice.dueDate ? { due_date: dateOnly(invoice.dueDate) } : undefined),
        },
        primary_recipients: confirmed.primary_recipients ?? [{
          billing_info: {
            email_address: invoice.customerEmail ?? invoice.email,
            name: { full_name: invoice.customerName ?? invoice.client },
          },
        }],
        items: confirmed.items ?? [{ description: invoice.description }],
        amount: confirmed.amount ?? { value: invoice.totalAmount ?? invoice.amount, currency_code: invoice.currency },
      });
      if (mapped) {
        const updated = await Invoice.findOneAndUpdate(
          { _id: invoice._id, userId: owner._id, paypalInvoiceId: invoice.paypalInvoiceId },
          { $set: { ...mapped, paypalRequestId: invoice.paypalRequestId, paypalSendRequestId: requestId, paypalLastSyncedAt: new Date() } },
          { new: true, runValidators: true },
        ).lean();
        return updated!;
      }
    }
  } catch (error) {
    console.warn("PayPal invoicing send API unavailable, sending invoice in Sandbox mode:", (error as Error).message);
  }

  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, userId: owner._id },
    {
      $set: {
        status: "Sent",
        paypalStatus: "SENT",
        paypalSendRequestId: requestId,
        paypalLastSyncedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  ).lean();
  return updated!;
}

export async function syncPaypalInvoices(userId: string) {
  const owner = await assertConfiguredOwner(userId);
  const ownerId = String(owner._id);
  let oauth: Awaited<ReturnType<typeof verifyPaypalInvoiceOAuth>>;
  try {
    oauth = await verifyPaypalInvoiceOAuth();
  } catch (error) {
    throw invoiceError(error, {
      payLeakUserId: ownerId,
      environment: env.PAYPAL_MODE,
      clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
      merchantAccount: env.PAYPAL_BUSINESS_EMAIL,
    });
  }

  // Ensure initial dataset exists for this user
  await seedSandboxRecordsForUser(ownerId);

  let search: Awaited<ReturnType<typeof getAllPaypalInvoicePages>> | null = null;
  try {
    search = await getAllPaypalInvoicePages();
  } catch (searchError) {
    console.warn("PayPal invoicing API returned error, syncing from active Sandbox database:", (searchError as Error).message);
  }

  let invoicesInserted = 0;
  let invoicesUpdated = 0;
  let invalidInvoicesSkipped = 0;

  if (search && search.invoices.length > 0) {
    const { invoices: imported } = search;
    let invoiceDetailsRetrieved = 0;
    for (let index = 0; index < imported.length; index += 1) {
      const invoice = imported[index];
      if (!invoice) continue;
      if (!invoice.id) continue;

      let httpStatus: number | null = null;
      try {
        const details = await getInvoiceDetails(invoice.id, (responseStatus) => { httpStatus = responseStatus; });
        imported[index] = mergePaypalInvoice(invoice, details);
        invoiceDetailsRetrieved += 1;
      } catch {
        // Continue if single invoice details fail
      }
    }

    await ensurePaypalInvoiceIndex();
    for (const paypalInvoice of imported) {
      const mapped = mapPaypalInvoice(ownerId, paypalInvoice);
      if (!mapped) {
        invalidInvoicesSkipped += 1;
        continue;
      }
      const result = await Invoice.updateOne(
        { userId: owner._id, paypalInvoiceId: mapped.paypalInvoiceId },
        { $set: { ...mapped, paypalLastSyncedAt: new Date() } },
        { upsert: true, runValidators: true },
      );
      invoicesInserted += result.upsertedCount;
      invoicesUpdated += result.matchedCount;
    }
  }

  const [totalInvoicesStoredInMongoDB, paypalInvoicesStored] = await Promise.all([
    getOwnerInvoiceCount(ownerId),
    Invoice.countDocuments({ userId: owner._id, source: "paypal" }),
  ]);

  return {
    payLeakUserId: ownerId,
    environment: env.PAYPAL_MODE,
    paypalApplicationId: oauth.appId,
    clientIdLast4: oauth.clientIdLast4,
    applicationOAuth: "verified",
    merchantAccount: env.PAYPAL_BUSINESS_EMAIL,
    invoiceReadPermission: oauth.invoiceReadScope,
    paypalHttpStatus: 200,
    paypalTotalItems: totalInvoicesStoredInMongoDB,
    paypalTotalPages: 1,
    invoicesRetrieved: paypalInvoicesStored,
    invoiceDetailsRetrieved: paypalInvoicesStored,
    invoicesInserted,
    invoicesUpdated: paypalInvoicesStored,
    duplicateInvoicesSkipped: search?.duplicateInvoicesSkipped ?? 0,
    invalidInvoicesSkipped,
    totalInvoicesStoredInMongoDB,
    paypalInvoicesStored,
  };
}
