import { Decimal } from "decimal.js";
import PDFDocument from "pdfkit";
import { Types } from "mongoose";
import { Client } from "../models/Client.js";
import { FinancialReport } from "../models/FinancialReport.js";
import { Invoice } from "../models/Invoice.ts";
import { AppError } from "../utils/errors.js";
import { formatCurrencyAmount } from "../utils/money.js";
import { generateFinancialAgentAnswer } from "./aiService.js";
import { listOwnedTransactionsForFinancialAnalysis } from "./transactionService.ts";
import { sharedPaypalInvoiceFilter } from "./paypalIntegrationService.js";

type MoneyTotals = Map<string, Decimal>;
type ClientRecord = {
  _id: Types.ObjectId;
  name: string;
  email?: string | null;
  company?: string | null;
};
type FinancialTransaction = {
  clientId?: Types.ObjectId | null;
  paypalTransactionId: string;
  transactionType: string;
  status: string;
  grossAmount: string;
  grossCurrency: string;
  feeAmount?: string | null;
  feeCurrency?: string | null;
  feeSource: string;
  paypalReportedNetAmount?: string | null;
  paypalReportedNetCurrency?: string | null;
  payleakCalculatedNetAmount?: string | null;
  payleakCalculatedNetCurrency?: string | null;
  conversion?: { source: string; sourceAmount?: string | null; sourceCurrency?: string | null; targetAmount?: string | null; targetCurrency?: string | null; exchangeRate?: string | null; convertedAt?: Date | null };
  withdrawalFeeAmount?: string | null;
  withdrawalFeeCurrency?: string | null;
  transactionDate: Date;
  rawPaypal?: { payer_info?: { email_address?: string; payer_name?: { alternate_full_name?: string } } };
};
type FinancialInvoice = {
  _id: Types.ObjectId;
  clientId?: Types.ObjectId | null;
  client?: string;
  email?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  amount: string;
  totalAmount?: string | null;
  paymentAmount?: string | null;
  currency: string;
  status: string;
  invoiceNumber?: string | null;
  invoiceDate: Date;
  paymentDate?: Date | null;
  dueDate?: Date | null;
};
type DatePeriod = { start?: Date; end?: Date };

function sumFor(totals: MoneyTotals, currency: string, value: string | Decimal) {
  totals.set(currency, (totals.get(currency) ?? new Decimal(0)).plus(value));
}

function serializeTotals(totals: MoneyTotals) {
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({
    currency,
    amount: formatCurrencyAmount(value, currency),
  }));
}

function parseAmount(value?: string | null) {
  if (value == null) return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function isRefundOrReversal(transaction: FinancialTransaction) {
  const gross = parseAmount(transaction.grossAmount);
  return /REFUND|REVERSAL|CHARGEBACK/i.test(transaction.transactionType)
    || ["V", "REFUNDED", "REVERSED"].includes(transaction.status.toUpperCase())
    || Boolean(gross?.isNegative());
}

function isSuccessful(transaction: FinancialTransaction) {
  return ["S", "COMPLETED", "SUCCESS", "SUCCEEDED"].includes(transaction.status.trim().toUpperCase());
}

function normalizeAssociation(value?: string | null) {
  return value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
}

function matchesClient(client: ClientRecord, transaction: FinancialTransaction, allClients: ClientRecord[]) {
  if (transaction.clientId) return String(transaction.clientId) === String(client._id);
  const payerInfo = transaction.rawPaypal?.payer_info;
  const payerEmail = normalizeAssociation(payerInfo?.email_address);
  const clientEmail = normalizeAssociation(client.email);
  if (payerEmail) return Boolean(clientEmail && clientEmail === payerEmail);

  const payerName = normalizeAssociation(payerInfo?.payer_name?.alternate_full_name);
  if (!payerName || payerName !== normalizeAssociation(client.name)) return false;
  return allClients.filter((candidate) => normalizeAssociation(candidate.name) === payerName).length === 1;
}

function matchesInvoice(client: ClientRecord, invoice: FinancialInvoice, allClients: ClientRecord[]) {
  if (invoice.clientId) return String(invoice.clientId) === String(client._id);
  const invoiceEmail = (invoice.customerEmail || invoice.email || "").trim().toLowerCase();
  if (client.email && invoiceEmail && client.email.toLowerCase() === invoiceEmail) return true;
  const invoiceName = (invoice.customerName || invoice.client || "").trim().toLowerCase();
  return Boolean(invoiceName
    && invoiceName === client.name.trim().toLowerCase()
    && allClients.filter((candidate) => candidate.name.trim().toLowerCase() === invoiceName).length === 1);
}

function filterPeriod<T extends { transactionDate?: Date; invoiceDate?: Date }>(rows: T[], period?: DatePeriod) {
  if (!period?.start && !period?.end) return rows;
  return rows.filter((row) => {
    const date = row.transactionDate ?? row.invoiceDate;
    return Boolean(date
      && (!period.start || date >= period.start)
      && (!period.end || date <= period.end));
  });
}

function deduplicateTransactions(transactions: FinancialTransaction[], period?: DatePeriod) {
  const rows = filterPeriod(transactions, period)
    .sort((a, b) => b.transactionDate.getTime() - a.transactionDate.getTime());
  const seen = new Set<string>();
  return rows.filter((transaction, index) => {
    const id = transaction.paypalTransactionId?.trim();
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function calculateClientFinancialSummary(
  client: ClientRecord,
  allTransactions: FinancialTransaction[],
  allInvoices: FinancialInvoice[],
  period?: DatePeriod,
  allClients: ClientRecord[] = [client],
) {
  const transactions = deduplicateTransactions(
    allTransactions.filter((row) => matchesClient(client, row, allClients)),
    period,
  );
  const invoices = filterPeriod(allInvoices.filter((row) => matchesInvoice(client, row, allClients)), period)
    .sort((a, b) => b.invoiceDate.getTime() - a.invoiceDate.getTime());
  const revenue = new Map<string, Decimal>();
  const refunds = new Map<string, Decimal>();
  const fees = new Map<string, Decimal>();
  const withdrawalFees = new Map<string, Decimal>();
  const outstanding = new Map<string, Decimal>();
  const paymentCounts = new Map<string, number>();
  const successful = transactions.filter(isSuccessful);

  for (const transaction of successful) {
    const gross = parseAmount(transaction.grossAmount);
    if (gross && isRefundOrReversal(transaction)) {
      sumFor(refunds, transaction.grossCurrency, gross.abs());
    } else if (gross?.greaterThan(0)) {
      sumFor(revenue, transaction.grossCurrency, gross);
      paymentCounts.set(transaction.grossCurrency, (paymentCounts.get(transaction.grossCurrency) ?? 0) + 1);
    }

    const fee = transaction.feeSource === "actual_paypal" ? parseAmount(transaction.feeAmount) : null;
    if (fee && transaction.feeCurrency) sumFor(fees, transaction.feeCurrency, fee.abs());

    if (transaction.withdrawalFeeAmount && transaction.withdrawalFeeCurrency) {
      const withdrawalFee = parseAmount(transaction.withdrawalFeeAmount);
      if (withdrawalFee) sumFor(withdrawalFees, transaction.withdrawalFeeCurrency, withdrawalFee.abs());
    }
  }

  let paidInvoiceCount = 0;
  let overdueInvoiceCount = 0;
  let unpaidInvoiceCount = 0;
  const settlementDurations = invoices
    .filter((invoice) => invoice.status === "Paid" && invoice.paymentDate)
    .map((invoice) => Math.max(0, invoice.paymentDate!.getTime() - invoice.invoiceDate.getTime()) / 86_400_000);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (const invoice of invoices) {
    if (invoice.status === "Paid") paidInvoiceCount += 1;
    const total = parseAmount(invoice.totalAmount ?? invoice.amount);
    if (!total || ["Paid", "Cancelled", "Refunded", "Draft"].includes(invoice.status)) continue;
    const paid = parseAmount(invoice.paymentAmount) ?? new Decimal(0);
    const balance = Decimal.max(total.minus(paid), 0);
    if (balance.gt(0)) {
      sumFor(outstanding, invoice.currency, balance);
      unpaidInvoiceCount += 1;
    }
    if (invoice.status === "Overdue" || (invoice.dueDate && invoice.dueDate < today && balance.gt(0))) overdueInvoiceCount += 1;
  }
  for (const currency of revenue.keys()) {
    if (!outstanding.has(currency)) outstanding.set(currency, new Decimal(0));
  }

  const recordedPaymentCosts = new Map<string, Decimal>();
  for (const [currency, fee] of fees) sumFor(recordedPaymentCosts, currency, fee);
  for (const [currency, fee] of withdrawalFees) sumFor(recordedPaymentCosts, currency, fee);
  const revenueMinusRecordedCosts = new Map<string, Decimal>();
  const amountAfterTransactionFees = new Map<string, Decimal>();
  for (const [currency, gross] of revenue) {
    revenueMinusRecordedCosts.set(currency, gross.minus(recordedPaymentCosts.get(currency) ?? 0).minus(refunds.get(currency) ?? 0));
    amountAfterTransactionFees.set(currency, gross.minus(fees.get(currency) ?? 0));
  }
  const costCurrenciesWithoutRevenue = [...recordedPaymentCosts.keys()].filter((currency) => !revenue.has(currency));
  for (const currency of costCurrenciesWithoutRevenue) revenueMinusRecordedCosts.set(currency, (revenueMinusRecordedCosts.get(currency) ?? new Decimal(0)).minus(recordedPaymentCosts.get(currency)!));

  const transactionRows = transactions.map((transaction) => ({
    id: transaction.paypalTransactionId,
    date: transaction.transactionDate.toISOString(),
    type: transaction.transactionType,
    status: transaction.status,
    gross: { amount: transaction.grossAmount, currency: transaction.grossCurrency },
    fee: transaction.feeSource === "actual_paypal" && transaction.feeAmount
      ? { amount: transaction.feeAmount, currency: transaction.feeCurrency }
      : null,
    reportedNet: transaction.paypalReportedNetAmount
      ? { amount: transaction.paypalReportedNetAmount, currency: transaction.paypalReportedNetCurrency }
      : null,
    calculatedNet: transaction.payleakCalculatedNetAmount
      ? { amount: transaction.payleakCalculatedNetAmount, currency: transaction.payleakCalculatedNetCurrency }
      : null,
    conversion: transaction.conversion?.source === "actual_paypal"
      ? {
        exchangeRate: transaction.conversion.exchangeRate ?? null,
        targetAmount: transaction.conversion.targetAmount ?? null,
        targetCurrency: transaction.conversion.targetCurrency ?? null,
      }
      : null,
    refundOrReversal: isRefundOrReversal(transaction),
  }));
  const invoiceRows = invoices.map((invoice) => ({
    number: invoice.invoiceNumber ?? String(invoice._id),
    date: invoice.invoiceDate.toISOString(),
    paymentDate: invoice.paymentDate?.toISOString() ?? null,
    dueDate: invoice.dueDate?.toISOString() ?? null,
    status: invoice.status,
    amount: invoice.totalAmount ?? invoice.amount,
    paidAmount: invoice.paymentAmount ?? "0",
    currency: invoice.currency,
  }));
  const hasProjectRecords = false;
  const hasExpenseRecords = false;

  return {
    client: { id: String(client._id), name: client.name, email: client.email ?? null, company: client.company ?? null },
    period: period ? { start: period.start?.toISOString() ?? null, end: period.end?.toISOString() ?? null } : null,
    counts: {
      projects: null,
      completedProjects: null,
      ongoingProjects: null,
      invoices: invoices.length,
      paidInvoices: paidInvoiceCount,
      unpaidInvoices: unpaidInvoiceCount,
      overdueInvoices: overdueInvoiceCount,
      transactions: transactions.length,
      successfulTransactions: successful.length,
      positivePaymentCount: [...paymentCounts.values()].reduce((total, count) => total + count, 0),
      positivePaymentCountsByCurrency: Object.fromEntries(paymentCounts),
      conversionRecords: transactions.filter((item) => item.conversion?.source === "actual_paypal").length,
      failedTransactions: transactions.filter((item) => ["D", "DENIED", "FAILED"].includes(item.status.toUpperCase())).length,
      refundsAndReversals: transactions.filter(isRefundOrReversal).length,
    },
    amounts: {
      grossRevenueReceived: serializeTotals(revenue),
      transactionFees: serializeTotals(fees),
      withdrawalFees: serializeTotals(withdrawalFees),
      recordedPaymentCosts: serializeTotals(recordedPaymentCosts),
      refundsAndReversals: serializeTotals(refunds),
      outstandingInvoices: serializeTotals(outstanding),
      averagePaymentByCurrency: serializeTotals(new Map([...revenue].map(([currency, gross]) => [
        currency,
        gross.div(paymentCounts.get(currency) ?? 1),
      ]))),
      averageInvoiceSettlementDays: settlementDurations.length
        ? new Decimal(settlementDurations.reduce((total, days) => total + days, 0) / settlementDurations.length).toDecimalPlaces(1).toFixed(1)
        : null,
      revenueMinusRecordedCosts: serializeTotals(revenueMinusRecordedCosts),
      amountAfterRecordedTransactionFees: serializeTotals(amountAfterTransactionFees),
      netProfit: null,
      currencyConversionCosts: null,
      identifiableProjectExpenses: null,
    },
    dataCompleteness: {
      completeNetProfit: false,
      projectsAvailable: hasProjectRecords,
      projectExpensesAvailable: hasExpenseRecords,
      bankSettlementAvailable: false,
      conversionCostAvailable: false,
      notes: [
        "PayLeak has no project or project-expense records, so project profitability and complete net profit cannot be determined.",
        "Revenue less recorded transaction fees and refunds is a partial subtotal, not net profit.",
        "Invoice totals are kept separate from received transaction revenue to prevent double counting.",
        "Transactions are linked by stored client ID, exact registered client email, or an exact unique payer-name match when stronger identifiers are absent; invoices use the stored client ID or exact client name/email.",
        "Currency conversion differences and bank-side charges are not inferred from exchange rates or PayPal net values.",
      ],
    },
    transactions: transactionRows,
    invoices: invoiceRows,
    projects: [],
    projectExpenses: [],
    unlinkedRecords: {
      transactions: allTransactions.filter((row) => !matchesClient(client, row, allClients)).length,
      invoices: allInvoices.filter((row) => !matchesInvoice(client, row, allClients)).length,
    },
  };
}

export async function retrieveOwnedFinancialRecords<T>(userId: string, retrieve: () => Promise<T>): Promise<T> {
  try {
    return await retrieve();
  } catch (error) {
    console.error("Client financial data retrieval failed", JSON.stringify({
      ownerId: `...${userId.slice(-4)}`,
      errorType: error instanceof Error ? error.name : "UnknownError",
    }));
    throw new AppError(503, "Financial records could not be retrieved. Please try again.", "FINANCIAL_DATA_RETRIEVAL_FAILED");
  }
}

async function loadOwnedRecords(userId: string) {
  const ownerId = new Types.ObjectId(userId);
  const [clients, transactions, invoices] = await retrieveOwnedFinancialRecords(userId, async () => Promise.all([
    Client.find({ userId: ownerId }).select("_id name email company").sort({ name: 1 }).limit(501).lean(),
    listOwnedTransactionsForFinancialAnalysis(userId, 10001),
    Invoice.find(await sharedPaypalInvoiceFilter(userId)).select("_id clientId client email customerName customerEmail invoiceNumber amount totalAmount paymentAmount currency status invoiceDate paymentDate dueDate source").sort({ invoiceDate: -1 }).limit(10001).lean(),
  ]));
  if (clients.length > 500 || transactions.length > 10000 || invoices.length > 10000) {
    throw new AppError(413, "This account has more financial records than the current analysis limit. Apply a narrower date period and try again.", "FINANCIAL_ANALYSIS_LIMIT");
  }
  return { clients: clients as unknown as ClientRecord[], transactions: transactions as unknown as FinancialTransaction[], invoices: invoices as unknown as FinancialInvoice[] };
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function findClientCandidates(clients: ClientRecord[], query: string) {
  const normalized = normalize(query);
  const exact = clients.filter((client) => [client.name, client.email, client.company]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalize(value) === normalized));
  if (exact.length) return exact;
  const phrase = clients.filter((client) => [client.name, client.email, client.company]
    .filter((value): value is string => Boolean(value))
    .some((value) => normalize(value).length > 2 && normalized.includes(normalize(value))));
  if (phrase.length) return phrase;
  const partial = clients.filter((client) => [client.name, client.email, client.company]
    .filter((value): value is string => Boolean(value))
    .some((value) => {
      const candidate = normalize(value);
      if (normalized.includes(candidate) || candidate.includes(normalized)) return true;
      if (value.includes("@")) return false;
      return candidate.split(/[\s-]+/).some((token) => token.length >= 3 && new RegExp(`\\b${escapeRegex(token)}\\b`, "i").test(query));
    }));
  return partial;
}

export function shouldUseAccountWideSummary(question: string, hasTargetClient: boolean) {
  const asksForRanking = /\b(highest|most|top|rank|compare all|best|which client|compare (?:my )?clients)\b/i.test(question);
  const asksForClients = /\b(client|customer|projects?|invoices?|transactions?|profit|revenue|income|fees|outstanding|overdue|financial)\b/i.test(question);
  const explicitlyUnmatchedClient = /\b(?:with|for|about)\s+(?:the\s+)?client\b/i.test(question)
    || /\b(?:relationship|analysis|report)\s+with\s+[a-z][a-z0-9'-]*/i.test(question)
    || /\breport\s+for\s+[a-z][a-z0-9'-]*/i.test(question);
  return asksForRanking || (!hasTargetClient && (!asksForClients || !explicitlyUnmatchedClient));
}

export async function createClientFinancialReport(userId: string, clientId: string, period?: DatePeriod) {
  if (!Types.ObjectId.isValid(clientId)) throw new AppError(400, "Invalid client ID.", "CLIENT_ID_INVALID");
  const records = await loadOwnedRecords(userId);
  const client = records.clients.find((item) => String(item._id) === clientId);
  if (!client) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
  const summary = calculateClientFinancialSummary(client, records.transactions, records.invoices, period, records.clients);
  const insights = await generateFinancialAgentAnswer(
    "Summarize evidence-based financial observations and limitations for this client report. Do not invent amounts or suggest unsupported project conclusions.",
    [],
    {
      counts: summary.counts,
      amounts: summary.amounts,
      dataCompleteness: summary.dataCompleteness,
    },
  );
  const pdf = await buildClientReportPdf(summary, insights);
  const generatedAt = new Date();
  const safeName = client.name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "client";
  const report = await FinancialReport.create({
    userId: new Types.ObjectId(userId),
    clientId: client._id,
    reportType: "client",
    fileName: `PayLeak-${safeName}-financial-report.pdf`,
    contentType: "application/pdf",
    pdf,
    periodStart: period?.start ?? null,
    periodEnd: period?.end ?? null,
    generatedAt,
  });
  console.info("Client financial report generated", JSON.stringify({
    reportId: String(report._id),
    userId,
    clientId,
    generatedAt: generatedAt.toISOString(),
    periodStart: period?.start?.toISOString() ?? null,
    periodEnd: period?.end?.toISOString() ?? null,
  }));
  return { id: String(report._id), fileName: report.fileName, generatedAt: generatedAt.toISOString(), clientName: client.name };
}

export async function downloadFinancialReport(userId: string, reportId: string) {
  if (!Types.ObjectId.isValid(reportId)) throw new AppError(404, "Financial report not found.", "FINANCIAL_REPORT_NOT_FOUND");
  const report = await FinancialReport.findOne({ _id: reportId, userId: new Types.ObjectId(userId) })
    .select("+pdf");
  if (!report) throw new AppError(404, "Financial report not found.", "FINANCIAL_REPORT_NOT_FOUND");
  return { fileName: report.fileName, contentType: report.contentType, pdf: report.pdf };
}

function aggregateCurrencyTotals(summaries: ReturnType<typeof calculateClientFinancialSummary>[], key: "grossRevenueReceived" | "transactionFees" | "amountAfterRecordedTransactionFees" | "withdrawalFees" | "recordedPaymentCosts" | "refundsAndReversals" | "outstandingInvoices") {
  const totals = new Map<string, Decimal>();
  for (const summary of summaries) {
    for (const entry of summary.amounts[key] ?? []) sumFor(totals, entry.currency, entry.amount);
  }
  return serializeTotals(totals);
}

export function businessEvidence(summaries: ReturnType<typeof calculateClientFinancialSummary>[], type: string) {
  return {
    type,
    totals: {
      clients: summaries.length,
      transactions: summaries.reduce((total, summary) => total + summary.counts.transactions, 0),
      successfulTransactions: summaries.reduce((total, summary) => total + summary.counts.successfulTransactions, 0),
      positivePaymentCount: summaries.reduce((total, summary) => total + summary.counts.positivePaymentCount, 0),
      invoices: summaries.reduce((total, summary) => total + summary.counts.invoices, 0),
      overdueInvoices: summaries.reduce((total, summary) => total + summary.counts.overdueInvoices, 0),
    },
    amounts: {
      grossRevenueReceived: aggregateCurrencyTotals(summaries, "grossRevenueReceived"),
      transactionFees: aggregateCurrencyTotals(summaries, "transactionFees"),
      withdrawalFees: aggregateCurrencyTotals(summaries, "withdrawalFees"),
      recordedPaymentCosts: aggregateCurrencyTotals(summaries, "recordedPaymentCosts"),
      amountAfterRecordedTransactionFees: aggregateCurrencyTotals(summaries, "amountAfterRecordedTransactionFees"),
      refundsAndReversals: aggregateCurrencyTotals(summaries, "refundsAndReversals"),
      outstandingInvoices: aggregateCurrencyTotals(summaries, "outstandingInvoices"),
      averagePaymentByCurrency: aggregateAveragePayments(summaries),
      netProfit: null,
    },
    rankings: rankClients(summaries, type),
    clients: summaries.map((summary) => ({
      clientId: summary.client.id,
      clientName: summary.client.name,
      transactionIds: summary.transactions.map((transaction) => transaction.id),
      counts: summary.counts,
      amounts: summary.amounts,
      completeness: summary.dataCompleteness,
      period: summary.period,
    })),
    period: summaries[0]?.period ?? null,
    projectData: { projectsAvailable: false, projectExpensesAvailable: false, netProfit: "NOT_DETERMINED" },
    reportingRules: "Currencies are separate; net profit is not determined because project expenses and project records are unavailable.",
  };
}

export function accountFinancialEvidence(
  clients: ClientRecord[],
  allTransactions: FinancialTransaction[],
  allInvoices: FinancialInvoice[],
  type: string,
  period?: DatePeriod,
) {
  const transactions = deduplicateTransactions(allTransactions, period);
  const invoices = filterPeriod(allInvoices, period);
  const summaries = clients.map((client) =>
    calculateClientFinancialSummary(client, transactions, invoices, period, clients));
  const successful = transactions.filter(isSuccessful);
  const revenue = new Map<string, Decimal>();
  const fees = new Map<string, Decimal>();
  const withdrawalFees = new Map<string, Decimal>();
  const refunds = new Map<string, Decimal>();
  const outstanding = new Map<string, Decimal>();
  const paymentCounts = new Map<string, number>();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let overdueInvoices = 0;

  for (const transaction of successful) {
    const gross = parseAmount(transaction.grossAmount);
    if (gross && isRefundOrReversal(transaction)) {
      sumFor(refunds, transaction.grossCurrency, gross.abs());
    } else if (gross?.greaterThan(0)) {
      sumFor(revenue, transaction.grossCurrency, gross);
      paymentCounts.set(transaction.grossCurrency, (paymentCounts.get(transaction.grossCurrency) ?? 0) + 1);
    }

    const fee = transaction.feeSource === "actual_paypal" ? parseAmount(transaction.feeAmount) : null;
    if (fee && transaction.feeCurrency) sumFor(fees, transaction.feeCurrency, fee.abs());
    const withdrawalFee = parseAmount(transaction.withdrawalFeeAmount);
    if (withdrawalFee && transaction.withdrawalFeeCurrency) {
      sumFor(withdrawalFees, transaction.withdrawalFeeCurrency, withdrawalFee.abs());
    }
  }

  for (const invoice of invoices) {
    const total = parseAmount(invoice.totalAmount ?? invoice.amount);
    if (!total || ["Paid", "Cancelled", "Refunded", "Draft"].includes(invoice.status)) continue;
    const paid = parseAmount(invoice.paymentAmount) ?? new Decimal(0);
    const balance = Decimal.max(total.minus(paid), 0);
    if (balance.gt(0)) {
      sumFor(outstanding, invoice.currency, balance);
      if (invoice.status === "Overdue" || (invoice.dueDate && invoice.dueDate < today)) overdueInvoices += 1;
    }
  }
  for (const currency of revenue.keys()) {
    if (!outstanding.has(currency)) outstanding.set(currency, new Decimal(0));
  }

  const paymentCosts = new Map<string, Decimal>();
  for (const [currency, amount] of fees) sumFor(paymentCosts, currency, amount);
  for (const [currency, amount] of withdrawalFees) sumFor(paymentCosts, currency, amount);
  const amountAfterTransactionFees = new Map<string, Decimal>();
  for (const [currency, amount] of revenue) {
    amountAfterTransactionFees.set(currency, amount.minus(fees.get(currency) ?? 0));
  }
  const statusCounts = new Map<string, number>();
  for (const transaction of transactions) {
    const status = transaction.status.trim().toUpperCase() || "UNKNOWN";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const pendingTransactions = transactions.filter((transaction) =>
    ["P", "PENDING"].includes(transaction.status.trim().toUpperCase())).length;
  const failedTransactions = transactions.filter((transaction) =>
    ["D", "DENIED", "FAILED"].includes(transaction.status.trim().toUpperCase())).length;
  const duplicateTransactionsRemoved = Math.max(0, filterPeriod(allTransactions, period).length - transactions.length);
  const unlinkedTransactions = transactions.filter((transaction) =>
    !clients.some((client) => matchesClient(client, transaction, clients))).length;
  const clientsWithTransactions = summaries.filter((summary) => summary.counts.transactions > 0).length;

  return {
    type,
    totals: {
      clients: clients.length,
      clientsWithTransactions,
      transactions: transactions.length,
      successfulTransactions: successful.length,
      pendingTransactions,
      failedTransactions,
      excludedByStatus: Object.fromEntries(statusCounts),
      duplicateTransactionsRemoved,
      unlinkedTransactions,
      invoices: invoices.length,
      overdueInvoices,
    },
    amounts: {
      grossRevenueReceived: serializeTotals(revenue),
      transactionFees: serializeTotals(fees),
      withdrawalFees: serializeTotals(withdrawalFees),
      recordedPaymentCosts: serializeTotals(paymentCosts),
      amountAfterRecordedTransactionFees: serializeTotals(amountAfterTransactionFees),
      refundsAndReversals: serializeTotals(refunds),
      outstandingInvoices: serializeTotals(outstanding),
      averagePaymentByCurrency: serializeTotals(new Map([...revenue].map(([currency, amount]) => [
        currency,
        amount.div(paymentCounts.get(currency) ?? 1),
      ]))),
      netProfit: null,
    },
    rankings: rankClients(summaries, type),
    clients: summaries.map((summary) => ({
      clientId: summary.client.id,
      clientName: summary.client.name,
      transactionIds: summary.transactions.map((transaction) => transaction.id),
      counts: summary.counts,
      amounts: summary.amounts,
      completeness: summary.dataCompleteness,
      period: summary.period,
    })),
    transactionIds: transactions.map((transaction) => transaction.paypalTransactionId),
    period: period ? { start: period.start?.toISOString() ?? null, end: period.end?.toISOString() ?? null } : null,
    projectData: { projectsAvailable: false, projectExpensesAvailable: false, netProfit: "NOT_DETERMINED" },
    reportingRules: "Account totals are calculated once from deduplicated owner-scoped transaction records; currencies remain separate and client rankings use only safely associated records.",
    diagnostic: {
      clientsRetrieved: clients.length,
      transactionsRetrieved: allTransactions.length,
      transactionsAfterPeriodAndDeduplication: transactions.length,
      invoicesRetrieved: allInvoices.length,
      successfulTransactions: successful.length,
      pendingTransactions,
      failedTransactions,
      duplicateTransactionsRemoved,
      unlinkedTransactions,
      aggregationResultCount: transactions.length,
    },
  };
}

export function deterministicRankingAnswer(
  question: string,
  evidence: { rankings: ReturnType<typeof rankClients> },
) {
  const asksProfit = /\b(?:net\s+profit|profitability|most\s+profitable|highest\s+profit)\b/i.test(question);
  if (asksProfit) {
    return "I can't identify the highest net-profit client from the available records. Project and expense records are not tracked, so revenue less payment fees is not a valid net-profit measure.";
  }
  if (/\bprojects?\b/i.test(question)) {
    return "I can't rank clients by project count because project records are not available in this PayLeak installation.";
  }
  if (/\b(?:payment history|reliability|fastest|slowest|payment delays)\b/i.test(question)) {
    return "I can't rank payment reliability from the available records. PayLeak has only partial invoice dates and payment dates, and no complete project/payment history.";
  }
  if (!evidence.rankings) {
    return "Client rankings are unavailable for this request because no client comparison was selected.";
  }
  const key = /\b(?:fee|fees|transaction cost|transaction costs)\b/i.test(question)
    ? "byTransactionFees"
    : /\b(?:outstanding|unpaid|overdue)\b/i.test(question)
      ? "byOutstandingInvoices"
      : "byRevenue";
  const label = key === "byTransactionFees" ? "recorded PayPal transaction fees"
    : key === "byOutstandingInvoices" ? "outstanding invoice balances"
      : "received gross revenue";
  const groups = evidence.rankings[key];
  if (!groups.length) return `There are no comparable ${label} records for the selected clients.`;
  const topFive = /\btop\s*(?:five|5)\b|\bcompare\b/i.test(question);
  const results = groups.map((group) => {
    const clients = group.clients.slice(0, topFive ? 5 : 1);
    return `${group.currency}: ${clients.map((item, index) => `${topFive ? `${index + 1}. ` : ""}${item.clientName} (${item.amount} ${group.currency})`).join("; ")}`;
  });
  return `Ranking by ${label}, compared only within each currency:\n${results.join("\n")}\nThis ranking does not establish net profit.`;
}

function rankClients(
  summaries: ReturnType<typeof calculateClientFinancialSummary>[],
  type: string,
) {
  if (type !== "client_comparison" && type !== "selected_client_comparison") return null;
  return {
    netProfit: {
      status: "NOT_DETERMINED",
      explanation: "Project expenses and project records are unavailable; recorded revenue less payment fees is not net profit.",
    },
    byRevenue: rankByAmounts(summaries, "grossRevenueReceived"),
    byTransactionFees: rankByAmounts(summaries, "transactionFees"),
    byOutstandingInvoices: rankByAmounts(summaries, "outstandingInvoices"),
    byProjectCount: {
      status: "NOT_AVAILABLE",
      explanation: "Project records are not available in the current data model.",
    },
  };
}

function aggregateAveragePayments(summaries: ReturnType<typeof calculateClientFinancialSummary>[]) {
  const amounts = new Map<string, Decimal>();
  const counts = new Map<string, number>();
  for (const summary of summaries) {
    for (const entry of summary.amounts.grossRevenueReceived) sumFor(amounts, entry.currency, entry.amount);
    for (const [currency, count] of Object.entries(summary.counts.positivePaymentCountsByCurrency)) {
      counts.set(currency, (counts.get(currency) ?? 0) + count);
    }
  }
  return serializeTotals(new Map([...amounts].map(([currency, value]) => [
    currency,
    value.div(counts.get(currency) ?? 1),
  ])));
}

function rankByAmounts(
  summaries: ReturnType<typeof calculateClientFinancialSummary>[],
  key: "grossRevenueReceived" | "transactionFees" | "outstandingInvoices",
) {
  const currencies = new Map<string, { clientName: string; amount: Decimal }[]>();
  for (const summary of summaries) {
    for (const total of summary.amounts[key] ?? []) {
      const entries = currencies.get(total.currency) ?? [];
      entries.push({ clientName: summary.client.name, amount: new Decimal(total.amount) });
      currencies.set(total.currency, entries);
    }
  }
  return [...currencies.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, entries]) => ({
    currency,
    clients: entries.sort((a, b) => b.amount.comparedTo(a.amount))
      .slice(0, 5)
      .map((entry) => ({ clientName: entry.clientName, amount: formatCurrencyAmount(entry.amount, currency) })),
  }));
}

export async function answerFinancialAgent(
  userId: string,
  question: string,
  contextClientId?: string,
  requestedPeriod?: DatePeriod,
  selectedClientId?: string,
) {
  const period = requestedPeriod ?? periodFromQuestion(question);
  const records = await loadOwnedRecords(userId);
  const questionText = question.trim();
  const asksForRanking = /\b(highest|most|top|rank|compare all|best|which client|compare (?:my )?clients)\b/i.test(questionText);
  const asksForClients = /\b(client|customer|projects?|invoices?|transactions?|profit|revenue|income|fees|outstanding|overdue|financial)\b/i.test(questionText);
  const asksForNamedComparison = /\bcompare\b/i.test(questionText) && explicitComparisonNames(questionText);
  const referential = /\b(he|she|his|her|that client|this client|that project|his project|her project|last project|their)\b/i.test(questionText);
  const reportFollowUp = /\b(?:the|that|this)\s+report\b|\bgenerate (?:a |the )?(?:pdf )?report\b/i.test(questionText);
  const explicitMatches = findClientCandidates(records.clients, questionText);
  let targetClient: ClientRecord | undefined;
  if (selectedClientId) {
    targetClient = records.clients.find((client) => String(client._id) === selectedClientId);
    if (!targetClient) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
  }
  if (!targetClient && explicitMatches.length > 1) {
    if (!asksForNamedComparison) {
      return {
        answer: "I found multiple matching clients. Please identify the exact client by name or email before I analyse their records.",
        source: "owned_client_records",
        ambiguousClients: explicitMatches.map(({ _id, name, email }) => ({ id: String(_id), name, email: email ?? null })),
        reportClientId: null,
        summary: null,
      };
    }
  }
  if (!targetClient && explicitMatches.length === 1) targetClient = explicitMatches[0];
  if (!targetClient && contextClientId && (referential || reportFollowUp)) {
    targetClient = records.clients.find((item) => String(item._id) === contextClientId);
  }

  if (shouldUseAccountWideSummary(questionText, Boolean(targetClient)) && !asksForNamedComparison) {
    const evidence = accountFinancialEvidence(
      records.clients,
      records.transactions,
      records.invoices,
      asksForRanking ? "client_comparison" : "business_summary",
      period,
    );
    console.info("Account-wide client financial analysis", JSON.stringify({
      ownerId: `...${userId.slice(-4)}`,
      clientsRetrieved: evidence.diagnostic.clientsRetrieved,
      transactionsRetrieved: evidence.diagnostic.transactionsRetrieved,
      invoicesRetrieved: evidence.diagnostic.invoicesRetrieved,
      successfulTransactions: evidence.diagnostic.successfulTransactions,
      pendingTransactions: evidence.diagnostic.pendingTransactions,
      failedTransactions: evidence.diagnostic.failedTransactions,
      duplicateTransactionsRemoved: evidence.diagnostic.duplicateTransactionsRemoved,
      unlinkedTransactions: evidence.diagnostic.unlinkedTransactions,
      aggregationResultCount: evidence.diagnostic.aggregationResultCount,
    }));
    if (asksForRanking) {
      return {
        answer: deterministicRankingAnswer(questionText, evidence),
        source: "backend_calculated_client_records",
        ambiguousClients: [],
        reportClientId: null,
        summary: evidence,
      };
    }
    const answer = await generateFinancialAgentAnswer(questionText, [], evidence);
    return { answer, source: "backend_calculated_client_records", ambiguousClients: [], reportClientId: null, summary: evidence };
  }

  if (!targetClient && asksForClients && !shouldUseAccountWideSummary(questionText, false) && !asksForNamedComparison) {
    return {
      answer: "I could not identify a registered client from that question. Use the exact client name or registered email shown in PayLeak.",
      source: "owned_client_records",
      ambiguousClients: [],
      reportClientId: null,
      summary: null,
    };
  }

  if (asksForNamedComparison) {
    const clientSummaries = explicitMatches.map((client) => calculateClientFinancialSummary(client, records.transactions, records.invoices, period, records.clients));
    const evidence = businessEvidence(clientSummaries, "selected_client_comparison");
    const answer = await generateFinancialAgentAnswer(questionText, [], evidence);
    return { answer, source: "backend_calculated_client_records", ambiguousClients: [], reportClientId: null, summary: evidence };
  }

  const summary = calculateClientFinancialSummary(targetClient!, records.transactions, records.invoices, period, records.clients);
  const evidence = {
    clientId: summary.client.id,
    clientName: summary.client.name,
    transactionIds: summary.transactions.map(({ id }) => id),
    period: summary.period,
    counts: summary.counts,
    amounts: summary.amounts,
    dataCompleteness: summary.dataCompleteness,
    recentTransactions: summary.transactions.slice(0, 10).map(({ date, type, status, gross, fee, reportedNet, calculatedNet, refundOrReversal }) => ({
      date, type, status, gross, fee, reportedNet, calculatedNet, refundOrReversal,
    })),
    recentInvoices: summary.invoices.slice(0, 10).map(({ date, dueDate, status, amount, paidAmount, currency, paymentDate }) => ({
      date, dueDate, paymentDate, status, amount, paidAmount, currency,
    })),
    projects: [],
    projectExpenses: [],
  };
  const resolvedQuestion = targetClient && (referential || reportFollowUp)
    ? `${questionText}\nContext: This question refers to the registered client ${targetClient.name}.`
    : questionText;
  const answer = await generateFinancialAgentAnswer(resolvedQuestion, [], evidence);
  return {
    answer,
    source: "backend_calculated_client_records",
    ambiguousClients: [],
    reportClientId: summary.client.id,
    summary: { ...summary, transactions: summary.transactions.slice(0, 100), invoices: summary.invoices.slice(0, 100) },
  };
}

function explicitComparisonNames(question: string) {
  return /\bcompare\s+.+\s+(?:and|with|to|versus|vs\.?)\s+.+/i.test(question);
}

function moneyText(items: { currency: string; amount: string }[] | null) {
  return items?.length ? items.map((item) => `${item.currency} ${item.amount}`).join(" · ") : "Unavailable";
}

export async function buildClientReportPdf(summary: ReturnType<typeof calculateClientFinancialSummary>, insights = "AI insights are unavailable in this report generation.") {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `PayLeak Client Financial Report - ${summary.client.name}`, Author: "PayLeak" } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const title = (heading: string, subtitle: string) => {
    doc.fillColor("#4f3bc8").font("Helvetica-Bold").fontSize(21).text("PayLeak", { continued: true });
    doc.fillColor("#303548").font("Helvetica").fontSize(10).text("  |  Client Financial Intelligence");
    doc.moveDown(1.2).fillColor("#303548").font("Helvetica-Bold").fontSize(17).text(heading);
    doc.moveDown(0.35).fillColor("#707688").font("Helvetica").fontSize(9).text(subtitle);
    doc.moveDown(1);
    doc.strokeColor("#e9eaf1").moveTo(48, doc.y).lineTo(547, doc.y).stroke();
    doc.moveDown();
  };
  const section = (heading: string, body: string) => {
    doc.moveDown(0.8).fillColor("#4f3bc8").font("Helvetica-Bold").fontSize(11).text(heading);
    doc.moveDown(0.3).fillColor("#42485b").font("Helvetica").fontSize(9).text(body, { lineGap: 3 });
  };
  const drawTable = (headers: string[], rows: string[][], widths: number[]) => {
    let y = doc.y;
    const drawRow = (values: string[], header: boolean) => {
      const fontSize = header ? 7 : 6.5;
      const height = header ? 24 : 34;
      let x = 48;
      for (let column = 0; column < widths.length; column += 1) {
        const width = widths[column]!;
        doc.rect(x, y, width, height)
          .fillAndStroke(header ? "#f5f3fc" : "#ffffff", "#e7e8ef");
        doc.fillColor(header ? "#5545a8" : "#464b5d")
          .font(header ? "Helvetica-Bold" : "Helvetica")
          .fontSize(fontSize)
          .text(values[column] ?? "Unavailable", x + 3, y + 5, { width: width - 6, height: height - 8, ellipsis: true });
        x += width;
      }
      y += height;
    };
    drawRow(headers, true);
    for (const row of rows) drawRow(row, false);
    doc.y = y + 9;
  };
  const pageSubtitle = `Generated ${new Date().toISOString()} · ${summary.period?.start || "All available dates"} to ${summary.period?.end || "present"}`;

  title("Client overview", pageSubtitle);
  doc.fillColor("#303548").font("Helvetica-Bold").fontSize(14).text(summary.client.name);
  if (summary.client.company) doc.font("Helvetica").fontSize(10).text(summary.client.company);
  if (summary.client.email) doc.font("Helvetica").fontSize(9).fillColor("#707688").text(summary.client.email);
  section("Activity", `Projects: unavailable · Invoices: ${summary.counts.invoices} · Paid: ${summary.counts.paidInvoices} · Unpaid: ${summary.counts.unpaidInvoices} · Overdue: ${summary.counts.overdueInvoices} · PayPal transactions: ${summary.counts.transactions} · Average recorded invoice settlement: ${summary.amounts.averageInvoiceSettlementDays == null ? "unavailable" : `${summary.amounts.averageInvoiceSettlementDays} days`}`);
  section("Received revenue by currency", moneyText(summary.amounts.grossRevenueReceived));
  section("Recorded PayPal transaction fees", moneyText(summary.amounts.transactionFees));
  section("Recorded withdrawal fees", moneyText(summary.amounts.withdrawalFees));
  section("Outstanding invoice balances", moneyText(summary.amounts.outstandingInvoices));
  section("Profit status", "Complete net profit cannot be determined because this installation has no project or project-expense records. Revenue less listed payment costs is not presented as net profit.");

  doc.addPage();
  title("Transaction analysis", "PayPal Transaction Search records attributed by client ID or exact registered client email.");
  drawTable(
    ["Transaction ID", "Date", "Event/status", "Invoice", "Project", "Gross", "Fee", "Conversion", "PayPal net"],
    summary.transactions.slice(0, 10).map((transaction) => [
      transaction.id,
      transaction.date.slice(0, 10),
      `${transaction.refundOrReversal ? "Refund/reversal" : transaction.type} · ${transaction.status}`,
      "Not linked",
      "Unavailable",
      `${transaction.gross.amount} ${transaction.gross.currency}`,
      transaction.fee ? `${transaction.fee.amount} ${transaction.fee.currency}` : "Unavailable",
      transaction.conversion?.exchangeRate ? `Rate ${transaction.conversion.exchangeRate}; cost n/a` : "Unavailable",
      transaction.reportedNet ? `${transaction.reportedNet.amount} ${transaction.reportedNet.currency}` : "Unavailable",
    ]),
    [77, 46, 48, 48, 48, 58, 54, 60, 60],
  );
  if (!summary.transactions.length) section("Transactions", "No linked PayPal transaction records are available for this client.");
  if (summary.transactions.length > 10) section("Additional records", `${summary.transactions.length - 10} older transaction records omitted from this PDF page.`);
  section("Invoice association", "No payment is linked to an invoice unless an explicit shared client association exists; invoice totals are not added to transaction revenue.");

  doc.addPage();
  title("Project-wise financial analysis", "Project and project-expense data are not currently modelled in this PayLeak installation.");
  drawTable(["Project", "Status", "Value", "Received", "Outstanding", "Expenses", "Profit"], [
    ["Unavailable", "Not tracked", "Unavailable", "Unavailable", "Unavailable", "Unavailable", "Not determined"],
  ], [82, 62, 65, 65, 76, 65, 84]);
  section("Project records", "Unavailable. Project names, status, agreed values, amounts received, and completion dates cannot be reported from the stored schema.");
  section("Project expenses", "Unavailable. No recorded project-expense collection exists, so per-project profit and margin are not determinable.");

  doc.addPage();
  title("Financial performance", "Only recorded amounts are shown. Different currencies are never added together.");
  section("Successful gross receipts", moneyText(summary.amounts.grossRevenueReceived));
  section("Recorded transaction fees", moneyText(summary.amounts.transactionFees));
  section("Gross receipts after recorded transaction fees", moneyText(summary.amounts.amountAfterRecordedTransactionFees));
  section("Recorded withdrawal fees", moneyText(summary.amounts.withdrawalFees));
  section("Recorded refunds and reversals", moneyText(summary.amounts.refundsAndReversals));
  section("Outstanding issued invoices", moneyText(summary.amounts.outstandingInvoices));
  section("Net profit", "Not fully determined: project expenses and other business expenses are unavailable.");
  section("Conversion and settlement", "Conversion losses, withdrawal costs, and bank receipt differences are not inferred and remain unavailable unless explicitly recorded.");

  doc.addPage();
  title("Insights and limitations", "Evidence-based observations from the records currently available.");
  section("Data completeness", summary.dataCompleteness.notes.join("\n"));
  section("Available activity", `${summary.counts.successfulTransactions} successful transactions and ${summary.counts.invoices} invoices matched to this client using exact association rules. Average recorded invoice settlement: ${summary.amounts.averageInvoiceSettlementDays == null ? "unavailable" : `${summary.amounts.averageInvoiceSettlementDays} days`}.`);
  section("AI-generated observations", insights);
  section("Recommended data improvements", "Add explicit project and project-expense records and link them to clients and invoices to determine project profitability. Link PayPal transactions to invoices when the relationship is verified. Record actual conversion and bank settlement charges before reporting them.");
  const pages = doc.bufferedPageRange();
  for (let pageIndex = pages.start; pageIndex < pages.start + pages.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    doc.save();
    doc.font("Helvetica").fontSize(8).fillColor("#9297a7")
      .text(`PayLeak · ${summary.client.name} · Page ${pageIndex + 1} of ${pages.count}`, 48, 760, { width: 499, align: "center" });
    doc.restore();
  }
  doc.end();
  return done;
}

export function getDatePeriod(start?: Date, end?: Date) {
  if (start && end && start > end) throw new AppError(400, "Period start must not be after period end.", "FINANCIAL_PERIOD_INVALID");
  return start || end ? { start, end } : undefined;
}

function periodFromQuestion(question: string): DatePeriod | undefined {
  const now = new Date();
  if (/\bthis month\b/i.test(question)) {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: now };
  }
  if (/\blast month\b/i.test(question)) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999)),
    };
  }
  if (/\blast six months\b/i.test(question)) {
    const start = new Date(now);
    start.setUTCMonth(start.getUTCMonth() - 6);
    return { start, end: now };
  }
  if (/\bthis year\b/i.test(question)) {
    return { start: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), end: now };
  }
  return undefined;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
