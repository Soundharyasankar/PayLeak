import { Decimal } from "decimal.js";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { paypalInvoiceCurrencies } from "../config/paypalCurrencies.js";
import { Invoice } from "../models/Invoice.ts";
import { AppError } from "../utils/errors.js";
import { calculateInvoiceLineItemTotal, normalizeInvoiceLineItems, type InvoiceLineItem } from "../utils/invoiceLineItems.js";
import { assertConfiguredOwner } from "./paypalService.ts";
import { ensurePaypalInvoiceIndex } from "./invoiceIndexService.js";
import { paypalRequest, verifyPaypalInvoiceOAuth } from "./paypalClient.js";

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
  items?: Array<{
    name?: string;
    description?: string;
    quantity?: string;
    unit_amount?: PaypalMoney;
  }>;
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
  project?: string;
  services?: string[];
  lineItems?: InvoiceLineItem[];
  amount: string;
  currency: string;
  description: string;
  date: Date;
  due: Date;
}

function validateInvoiceCurrencyAndAmount(input: PaypalInvoiceCreationInput) {
  const currency = paypalInvoiceCurrencies[input.currency as keyof typeof paypalInvoiceCurrencies];
  if (!currency) {
    throw new AppError(422, "This currency is not available for PayPal invoicing. No conversion was applied.", "PAYPAL_CURRENCY_UNSUPPORTED");
  }
  let amount: Decimal;
  try {
    amount = new Decimal(input.amount);
  } catch {
    throw new AppError(422, "Invoice amount must be a valid decimal number.", "INVOICE_AMOUNT_INVALID");
  }
  if (!amount.isFinite() || amount.lte(0)) {
    throw new AppError(422, "Invoice amount must be greater than zero.", "INVOICE_AMOUNT_INVALID");
  }
  if (amount.decimalPlaces() > currency.fractionDigits) {
    throw new AppError(422, `${input.currency} amounts cannot have more than ${currency.fractionDigits} decimal places.`, "INVOICE_AMOUNT_PRECISION_INVALID");
  }
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function completeInvoiceDescription(input: PaypalInvoiceCreationInput) {
  const missingServices = (input.services ?? []).filter((service) =>
    !input.description.toLocaleLowerCase().includes(service.toLocaleLowerCase()),
  );
  return [input.description, ...missingServices.map((service) => `- ${service}`)]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000);
}

export function buildPaypalInvoicePayload(input: PaypalInvoiceCreationInput) {
  validateInvoiceCurrencyAndAmount(input);
  const lineItems = normalizeInvoiceLineItems(
    input.lineItems,
    input.project,
    completeInvoiceDescription(input),
    input.amount,
    input.currency,
  );
  const lineItemsTotal = calculateInvoiceLineItemTotal(lineItems, input.currency);
  if (!new Decimal(input.amount).eq(lineItemsTotal)) {
    throw new AppError(422, "Invoice total must equal the sum of its line items.", "INVOICE_LINE_ITEM_TOTAL_MISMATCH");
  }
  const [givenName, ...surnameParts] = input.client.trim().split(/\s+/);
  const description = completeInvoiceDescription(input);
  return {
    detail: {
      invoice_date: dateOnly(input.date),
      currency_code: input.currency,
      memo: input.project ? `${input.project}\n${description}` : description,
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
    items: lineItems.map((item) => ({
      name: item.description.slice(0, 200),
      description: item.description,
      quantity: "1",
      unit_amount: { currency_code: input.currency, value: item.amount },
    })),
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
  let confirmed = created;
  if (!confirmed.status || !confirmed.detail?.invoice_number
    || !confirmed.detail.currency_code || !confirmed.amount?.currency_code || !confirmed.amount.value) {
    const details = await getInvoiceDetails(created.id, () => undefined);
    confirmed = mergePaypalInvoice(created, details);
  }
  const amount = confirmed.amount?.value;
  const currencyCodes = [
    confirmed.detail?.currency_code,
    confirmed.amount?.currency_code,
    ...(confirmed.items?.map((item) => item.unit_amount?.currency_code) ?? []),
  ].filter((code): code is string => Boolean(code));
  if (currencyCodes.some((code) => code !== input.currency)) {
    throw new AppError(502, "PayPal returned an invoice in a different currency. PayLeak did not save it as a successful invoice.", "PAYPAL_INVOICE_CURRENCY_MISMATCH", {
      paypalInvoiceId: confirmed.id,
    });
  }
  if (!amount || !new Decimal(amount).eq(input.amount)) {
    throw new AppError(502, "PayPal did not confirm the requested invoice amount. PayLeak did not save the invoice.", "PAYPAL_INVOICE_AMOUNT_MISMATCH", {
      paypalInvoiceId: confirmed.id,
    });
  }
  return confirmed;
}

export async function updatePaypalInvoiceRecord(
  invoiceId: string,
  input: PaypalInvoiceCreationInput,
) {
  const updated = await paypalRequest<PaypalInvoiceRecord | undefined>(
    `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(buildPaypalInvoicePayload(input)),
    },
  );
  const details = await getInvoiceDetails(invoiceId, () => undefined);
  const confirmed = mergePaypalInvoice(updated ?? { id: invoiceId }, details);
  const currencies = [
    confirmed.detail?.currency_code,
    confirmed.amount?.currency_code,
    ...(confirmed.items?.map((item) => item.unit_amount?.currency_code) ?? []),
  ].filter((code): code is string => Boolean(code));
  if (currencies.some((code) => code !== input.currency)) {
    throw new AppError(502, "PayPal did not confirm the requested invoice currency.", "PAYPAL_INVOICE_CURRENCY_MISMATCH");
  }
  if (!confirmed.amount?.value || !new Decimal(confirmed.amount.value).eq(input.amount)) {
    throw new AppError(502, "PayPal did not confirm the requested invoice amount.", "PAYPAL_INVOICE_AMOUNT_MISMATCH");
  }
  if (confirmed.status && confirmed.status.toUpperCase() !== "DRAFT") {
    throw new AppError(409, "PayPal no longer considers this invoice a draft, so it cannot be edited.", "PAYPAL_INVOICE_NOT_EDITABLE");
  }
  return confirmed;
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
    lineItems: (invoice.items ?? []).flatMap((item) => {
      const itemCurrency = item.unit_amount?.currency_code;
      const itemAmount = item.unit_amount?.value;
      const itemDescription = item.description || item.name;
      if (!itemCurrency || itemCurrency !== currency || !itemAmount || !itemDescription) return [];
      return [{ description: itemDescription, amount: itemAmount }];
    }),
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
  const lineItems = normalizeInvoiceLineItems(
    input.lineItems,
    input.project,
    input.description,
    input.amount,
    input.currency,
  );
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
        project: input.project ?? "",
        services: input.services?.length ? input.services : lineItems.map(({ description }) => description),
        lineItems,
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
  const created = await createPaypalInvoiceRecord(input, requestId);
  return saveCreatedPaypalInvoice(String(owner._id), created, input, requestId);
}

export async function updatePaypalInvoiceDraft(
  userId: string,
  localInvoiceId: string,
  input: PaypalInvoiceCreationInput,
) {
  const owner = await assertConfiguredOwner(userId);
  const invoice = await Invoice.findOne({ _id: localInvoiceId, userId: owner._id });
  if (!invoice) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  if (invoice.source !== "paypal" || !invoice.paypalInvoiceId || invoice.status !== "Draft") {
    throw new AppError(409, "Only a PayPal-linked draft can be edited.", "PAYPAL_INVOICE_MANAGED");
  }
  const confirmed = await updatePaypalInvoiceRecord(invoice.paypalInvoiceId, input);
  const mapped = mapPaypalInvoice(String(owner._id), confirmed);
  if (!mapped || mapped.status !== "Draft") {
    throw new AppError(502, "PayPal did not confirm that the invoice remains a draft.", "PAYPAL_INVOICE_UPDATE_UNCONFIRMED");
  }
  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, userId: owner._id, paypalInvoiceId: invoice.paypalInvoiceId, status: "Draft" },
    {
      $set: {
        ...mapped,
        clientId: input.clientId ?? invoice.clientId,
        project: input.project ?? invoice.project,
        services: input.services ?? invoice.services,
        lineItems: input.lineItems ?? invoice.lineItems,
        paypalRequestId: invoice.paypalRequestId,
        paypalSendRequestId: invoice.paypalSendRequestId,
        paypalLastSyncedAt: new Date(),
      },
    },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) throw new AppError(409, "The invoice changed while it was being edited. Refresh and retry.", "PAYPAL_INVOICE_CHANGED");
  return updated;
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
    project: pendingInvoice.project,
    services: pendingInvoice.services,
    lineItems: normalizeInvoiceLineItems(
      pendingInvoice.lineItems,
      pendingInvoice.project,
      pendingInvoice.description,
      pendingInvoice.amount,
      pendingInvoice.currency,
    ),
    amount: pendingInvoice.amount,
    currency: pendingInvoice.currency,
    description: pendingInvoice.description,
    date: pendingInvoice.invoiceDate,
    due: pendingInvoice.dueDate ?? pendingInvoice.invoiceDate,
  };
  const lineItemsTotal = calculateInvoiceLineItemTotal(input.lineItems!, input.currency);
  if (!new Decimal(input.amount).eq(lineItemsTotal)) {
    throw new AppError(422, "Invoice total must equal the sum of its line items.", "INVOICE_LINE_ITEM_TOTAL_MISMATCH");
  }
  if (!pendingInvoice.lineItems.length) {
    pendingInvoice.set("lineItems", input.lineItems);
    if (!pendingInvoice.services.length) {
      pendingInvoice.services = input.lineItems!.map(({ description }) => description);
    }
    await pendingInvoice.save();
  }
  await ensurePaypalInvoiceIndex();
  const stableRequestId = pendingInvoice.paypalRequestId || requestId;
  let created: PaypalInvoiceRecord;
  try {
    created = await createPaypalInvoiceRecord(input, stableRequestId);
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 422 && [
      "PAYPAL_CURRENCY_UNSUPPORTED",
      "PAYPAL_INVALID_REQUEST",
    ].includes(error.code)) {
      await Invoice.updateOne(
        { _id: pendingInvoice._id, userId: owner._id, paypalRequestId: stableRequestId, paypalInvoiceId: { $exists: false } },
        { $unset: { paypalRequestId: 1 } },
      );
    }
    throw error;
  }
  return saveCreatedPaypalInvoice(String(owner._id), created, input, stableRequestId, String(pendingInvoice._id));
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
  const confirmed = await sendPaypalInvoiceRecord(invoice.paypalInvoiceId, requestId);
  if (!["SENT", "UNPAID", "OVERDUE"].includes(confirmed.status?.toUpperCase() ?? "")) {
    throw new AppError(502, "PayPal did not confirm that the invoice was sent. PayLeak status was not changed.", "PAYPAL_INVOICE_SEND_UNCONFIRMED", {
      paypalInvoiceId: invoice.paypalInvoiceId,
      paypalStatus: confirmed?.status ?? null,
    });
  }

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
  if (!mapped) {
    throw new AppError(502, "PayPal confirmed sending, but did not return invoice details that PayLeak can synchronize. Sync PayPal invoices to refresh the record.", "PAYPAL_INVOICE_SEND_SYNC_REQUIRED", {
      paypalInvoiceId: invoice.paypalInvoiceId,
      paypalStatus: confirmed.status,
    });
  }
  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, userId: owner._id, paypalInvoiceId: invoice.paypalInvoiceId },
    { $set: { ...mapped, paypalRequestId: invoice.paypalRequestId, paypalSendRequestId: requestId, paypalLastSyncedAt: new Date() } },
    { new: true, runValidators: true },
  ).lean();
  if (!updated) {
    throw new AppError(500, "PayPal sent the invoice, but PayLeak could not update it. Sync PayPal invoices to refresh the status.", "PAYPAL_INVOICE_SEND_PERSIST_FAILED", {
      paypalInvoiceId: invoice.paypalInvoiceId,
    });
  }
  return updated;
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
      merchantAccount: "not_returned_by_client_credentials_api",
    });
  }

  let search: Awaited<ReturnType<typeof getAllPaypalInvoicePages>>;
  try {
    search = await getAllPaypalInvoicePages();
  } catch (error) {
    throw invoiceError(error, {
      payLeakUserId: ownerId,
      environment: env.PAYPAL_MODE,
      paypalApplicationId: oauth.appId,
      clientIdLast4: oauth.clientIdLast4,
      applicationOAuth: "verified",
      merchantAccount: "not_returned_by_client_credentials_api",
      invoiceReadPermission: "verified_by_api_request",
      invoiceReadScopeClaim: oauth.invoiceReadScope,
      invoiceWriteScopeClaim: oauth.invoiceWriteScope,
      invoicesInserted: 0,
      invoicesUpdated: 0,
      totalInvoicesStoredInMongoDB: await getOwnerInvoiceCount(ownerId),
    });
  }
  const { invoices: imported, pages, paypalTotalItems, paypalTotalPages, duplicateInvoicesSkipped } = search;

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
    } catch (error) {
      throw invoiceError(error, {
        payLeakUserId: ownerId,
        environment: env.PAYPAL_MODE,
        paypalApplicationId: oauth.appId,
        clientIdLast4: oauth.clientIdLast4,
        applicationOAuth: "verified",
        merchantAccount: "not_returned_by_client_credentials_api",
        invoiceReadPermission: oauth.invoiceReadScope,
        paypalTotalItems,
        paypalTotalPages,
        invoicesRetrieved: imported.length,
        invoiceDetailsRetrieved,
        invoicesInserted: 0,
        invoicesUpdated: 0,
        duplicateInvoicesSkipped,
        totalInvoicesStoredInMongoDB: await getOwnerInvoiceCount(ownerId),
        invoiceId: invoice.id,
        paypalHttpStatus: httpStatus,
        pages,
      });
    }
  }

  await ensurePaypalInvoiceIndex();
  let invoicesInserted = 0;
  let invoicesUpdated = 0;
  let invalidInvoicesSkipped = 0;
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
    merchantAccount: "not_returned_by_client_credentials_api",
    invoiceReadPermission: oauth.invoiceReadScope,
    paypalHttpStatus: pages[0]?.httpStatus ?? null,
    paypalTotalItems,
    paypalTotalPages,
    invoicesRetrieved: imported.length,
    invoiceDetailsRetrieved,
    invoicesInserted,
    invoicesUpdated,
    duplicateInvoicesSkipped,
    invalidInvoicesSkipped,
    totalInvoicesStoredInMongoDB,
    paypalInvoicesStored,
    pages,
  };
}
