import { Types } from "mongoose";
import { Transaction } from "../models/Transaction.js";
import { AppError } from "../utils/errors.js";
import { calculateNetFromActual as calculateNetAmount } from "./financial.js";
import { sharedPaypalDataFilter } from "./paypalIntegrationService.js";

export async function listTransactions(userId: string, query: {
  page: number; limit: number; from?: Date; to?: Date; currency?: string; status?: string;
}) {
  const filter: Record<string, unknown> = await sharedPaypalDataFilter(userId);
  if (query.from || query.to) {
    filter.transactionDate = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
  }
  if (query.currency) filter.grossCurrency = query.currency;
  if (query.status) filter.status = query.status;
  const [records, total] = await Promise.all([
    Transaction.find(filter).sort({ transactionDate: -1 }).skip((query.page - 1) * query.limit).limit(query.limit).lean(),
    Transaction.countDocuments(filter),
  ]);
  return { items: records.map(toFrontendTransaction), page: query.page, limit: query.limit, total };
}

export function ownedTransactionFilter(userId: string) {
  return { userId: new Types.ObjectId(userId) };
}

export async function listOwnedTransactionsForFinancialAnalysis(userId: string, limit: number) {
  return Transaction.find(await sharedPaypalDataFilter(userId))
    .select("clientId paypalTransactionId transactionType status grossAmount grossCurrency feeAmount feeCurrency feeSource paypalReportedNetAmount paypalReportedNetCurrency payleakCalculatedNetAmount payleakCalculatedNetCurrency conversion withdrawalFeeAmount withdrawalFeeCurrency transactionDate rawPaypal")
    .sort({ transactionDate: -1 })
    .limit(limit)
    .lean();
}

async function findTransaction(userId: string, id: string) {
  const alternatives: Record<string, unknown>[] = [{ paypalTransactionId: id }];
  if (Types.ObjectId.isValid(id)) alternatives.push({ _id: new Types.ObjectId(id) });
  const record = await Transaction.findOne({
    $and: [await sharedPaypalDataFilter(userId), { $or: alternatives }],
  }).lean();
  if (!record) throw new AppError(404, "Transaction not found.", "TRANSACTION_NOT_FOUND");
  return record;
}

export async function getTransaction(userId: string, id: string) {
  const record = await findTransaction(userId, id);
  return toFrontendTransaction(record);
}

export async function transactionBreakdown(userId: string, id: string) {
  const transaction = await findTransaction(userId, id);
  const feeAvailable = transaction.feeSource === "actual_paypal" && transaction.feeAmount !== null && transaction.feeCurrency !== null;
  const conversionAvailable = transaction.conversion.source !== "unavailable";
  return {
    transactionId: transaction.paypalTransactionId,
    originalAmount: { value: transaction.grossAmount, currency: transaction.grossCurrency, source: "actual_paypal" },
    transactionFee: {
      value: feeAvailable ? transaction.feeAmount : null,
      currency: transaction.feeCurrency,
      source: feeAvailable ? "actual_paypal" : "unavailable",
      status: feeAvailable ? "actual_paypal" : "unavailable",
    },
    exchangeRate: {
      value: conversionAvailable ? transaction.conversion.exchangeRate : null,
      fromCurrency: transaction.conversion.sourceCurrency,
      toCurrency: transaction.conversion.targetCurrency,
      direction: transaction.conversion.rateDirection,
      source: conversionAvailable ? transaction.conversion.source : "unavailable",
    },
    convertedAmount: {
      value: conversionAvailable ? transaction.conversion.targetAmount : null,
      currency: transaction.conversion.targetCurrency,
      status: conversionAvailable ? "available" : "unavailable",
    },
    withdrawalFee: {
      value: transaction.withdrawalFeeAmount,
      currency: transaction.withdrawalFeeCurrency,
      status: transaction.withdrawalFeeAmount === null ? "unavailable" : "actual_paypal",
    },
    finalPayout: {
      value: transaction.finalAmount,
      currency: transaction.finalCurrency,
      status: transaction.finalAmount === null ? "incomplete" : "actual_paypal",
    },
    financialDataStatus: transaction.financialDataStatus,
  };
}

interface TransactionView {
  paypalTransactionId: string;
  grossAmount: string;
  grossCurrency: string;
  feeAmount?: string | null;
  feeCurrency?: string | null;
  feeSource: "actual_paypal" | "official_fee_reference" | "unavailable";
  finalAmount?: string | null;
  finalCurrency?: string | null;
  transactionDate: Date;
  status: string;
  transactionType: string;
  conversion: {
    source: string;
    sourceCurrency?: string | null;
    targetCurrency?: string | null;
    targetAmount?: string | null;
    exchangeRate?: string | null;
    rateDirection?: string | null;
  };
  financialDataStatus: string;
  retrievedAt: Date;
  rawPaypal: unknown;
}

function toFrontendTransaction(record: TransactionView) {
  const payer = (record.rawPaypal as { payer_info?: { payer_name?: { alternate_full_name?: string } } })?.payer_info;
  return {
    id: record.paypalTransactionId,
    client: payer?.payer_name?.alternate_full_name ?? "Unknown payer",
    gross: record.grossAmount,
    currency: record.grossCurrency,
    fee: record.feeAmount,
    feeCurrency: record.feeCurrency,
    feeSource: record.feeSource,
    net: record.finalCurrency === record.grossCurrency
      ? record.finalAmount
      : calculateNetAmount(record.grossAmount, record.grossCurrency, record.feeAmount ?? null, record.feeCurrency ?? null),
    date: record.transactionDate.toISOString().slice(0, 10),
    status: record.status,
    transactionType: record.transactionType,
    conversion: record.conversion,
    financialDataStatus: record.financialDataStatus,
    retrievedAt: record.retrievedAt,
  };
}

export function calculateNetFromActual(transaction: {
  grossAmount: string;
  grossCurrency: string;
  feeAmount: string | null;
  feeCurrency: string | null;
}) {
  if (transaction.feeAmount === null || transaction.feeCurrency !== transaction.grossCurrency) return null;
  return calculateNetAmount(transaction.grossAmount, transaction.grossCurrency, transaction.feeAmount, transaction.feeCurrency);
}
