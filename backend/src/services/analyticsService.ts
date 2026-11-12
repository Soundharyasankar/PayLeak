import { Decimal } from "decimal.js";
import { Types } from "mongoose";
import { Invoice } from "../models/Invoice.ts";
import { Transaction } from "../models/Transaction.js";
import { formatCurrencyAmount } from "../utils/money.js";
import { sharedPaypalDataFilter, sharedPaypalInvoiceFilter } from "./paypalIntegrationService.js";
import { confirmedPaymentFilter, isConfirmedPaymentTransaction } from "./transactionEligibility.js";

interface CurrencyTotals {
  currency: string;
  gross: Decimal;
  fees: Decimal;
  net: Decimal;
  grossCount: number;
  feeCount: number;
  netCount: number;
  unavailableFeeCount: number;
}

function totalsForCurrency(map: Map<string, CurrencyTotals>, currency: string) {
  let totals = map.get(currency);
  if (!totals) {
    totals = { currency, gross: new Decimal(0), fees: new Decimal(0), net: new Decimal(0), grossCount: 0, feeCount: 0, netCount: 0, unavailableFeeCount: 0 };
    map.set(currency, totals);
  }
  return totals;
}

interface DashboardTransaction {
  transactionType: string;
  status: string;
  grossAmount: string;
  grossCurrency: string;
  feeAmount?: string | null;
  feeCurrency?: string | null;
  feeSource?: string;
  conversion: { source: string };
}

export function summarizeDashboardTransactions(records: ReadonlyArray<DashboardTransaction>) {
  const confirmedPayments = records.filter(isConfirmedPaymentTransaction);
  const currencies = new Map<string, CurrencyTotals>();
  const feeCurrencies = new Map<string, Decimal>();
  let conversionUnknownCount = 0;
  let actualConversionCount = 0;

  for (const transaction of confirmedPayments) {
    const gross = totalsForCurrency(currencies, transaction.grossCurrency);
    gross.gross = gross.gross.plus(transaction.grossAmount);
    gross.grossCount += 1;
    if (transaction.feeSource === "actual_paypal" && transaction.feeAmount != null && transaction.feeCurrency) {
      const fee = new Decimal(transaction.feeAmount).abs();
      const currentFeeTotal = feeCurrencies.get(transaction.feeCurrency) ?? new Decimal(0);
      feeCurrencies.set(transaction.feeCurrency, currentFeeTotal.plus(fee));
      const sameCurrencyFee = transaction.feeCurrency === transaction.grossCurrency ? fee : null;
      if (sameCurrencyFee) {
        gross.fees = gross.fees.plus(sameCurrencyFee);
        gross.feeCount += 1;
        const net = new Decimal(transaction.grossAmount).minus(sameCurrencyFee);
        if (!net.isNegative()) {
          gross.net = gross.net.plus(net);
          gross.netCount += 1;
        }
      } else {
        gross.unavailableFeeCount += 1;
      }
    } else {
      gross.unavailableFeeCount += 1;
    }
    if (transaction.conversion.source === "actual_paypal" || transaction.conversion.source === "paypal_quote") actualConversionCount += 1;
    else conversionUnknownCount += 1;
  }

  return {
    transactionCount: confirmedPayments.length,
    currencies: [...currencies.values()].map((item) => ({
      currency: item.currency,
      totalGross: formatCurrencyAmount(item.gross, item.currency),
      totalActualFees: formatCurrencyAmount(item.fees, item.currency),
      totalNetWhenFeeCurrencyMatches: formatCurrencyAmount(item.net, item.currency),
      transactionCount: item.grossCount,
      feeCountSameCurrency: item.feeCount,
      feesUnavailableOrDifferentCurrency: item.unavailableFeeCount,
      netStatus: item.netCount === item.grossCount ? "complete" : "incomplete",
    })),
    feesByCurrency: [...feeCurrencies].map(([currency, value]) => ({
      currency,
      actualFees: formatCurrencyAmount(value, currency),
      source: "actual_paypal",
    })),
    conversions: {
      actualOrQuotedCount: actualConversionCount,
      unavailableCount: conversionUnknownCount,
      status: conversionUnknownCount ? "incomplete" : "complete",
      explanation: "Conversion totals are not inferred from generic market rates.",
    },
  };
}

export function summarizePaypalInvoices(records: ReadonlyArray<{ source?: string; status: string }>) {
  const paypalInvoices = records.filter((invoice) => invoice.source === "paypal");
  const byStatus = paypalInvoices.reduce<Record<string, number>>((result, invoice) => {
    result[invoice.status] = (result[invoice.status] ?? 0) + 1;
    return result;
  }, {});
  const openStatuses = new Set(["Draft", "Sent", "Partially Paid", "Overdue"]);

  return {
    total: paypalInvoices.length,
    openCount: paypalInvoices.filter((invoice) => openStatuses.has(invoice.status)).length,
    overdueCount: byStatus.Overdue ?? 0,
    byStatus,
  };
}

export async function dashboardAnalytics(userId: string) {
  const transactionFilter = await sharedPaypalDataFilter(userId);
  const eligibleTransactionFilter = { $and: [transactionFilter, confirmedPaymentFilter] };
  const invoiceFilter = await sharedPaypalInvoiceFilter(userId);
  const records = await Transaction.find(eligibleTransactionFilter)
    .select("transactionType status grossAmount grossCurrency feeAmount feeCurrency feeSource conversion")
    .lean();
  const transactionSummary = summarizeDashboardTransactions(records);

  const [invoices, monthly] = await Promise.all([
    Invoice.find(invoiceFilter).select("status amount currency source").lean(),
    monthlyIncome(eligibleTransactionFilter),
  ]);
  const statuses = invoices.reduce<Record<string, number>>((result, invoice) => {
    result[invoice.status] = (result[invoice.status] ?? 0) + 1;
    return result;
  }, {});

  return {
    ...transactionSummary,
    invoices: {
      total: invoices.length,
      byStatus: statuses,
      paypal: summarizePaypalInvoices(invoices),
    },
    monthly,
  };
}

async function monthlyIncome(filter: Record<string, unknown>) {
  const rows = await Transaction.aggregate<{ _id: { year: number; month: number; currency: string }; amount: string; count: number }>([
    { $match: filter },
    { $group: {
      _id: {
        year: { $year: "$transactionDate" },
        month: { $month: "$transactionDate" },
        currency: "$grossCurrency",
      },
      amount: { $sum: { $convert: { input: "$grossAmount", to: "decimal", onError: "0", onNull: "0" } } },
      count: { $sum: 1 },
    } },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);
  return rows.map((row) => ({
    year: row._id.year,
    month: row._id.month,
    currency: row._id.currency,
    grossAmount: formatCurrencyAmount(new Decimal(String(row.amount)), row._id.currency),
    transactionCount: row.count,
    source: "actual_paypal",
  }));
}

export async function leakAnalytics(userId: string) {
  const records = await Transaction.find(await sharedPaypalDataFilter(userId)).select("paypalTransactionId feeAmount feeCurrency feeSource conversion transactionDate transactionType status").sort({ transactionDate: -1 }).limit(500).lean();
  const fees = new Map<string, Decimal>();
  for (const transaction of records) {
    if (transaction.feeSource !== "actual_paypal" || transaction.feeAmount == null || !transaction.feeCurrency) continue;
    fees.set(transaction.feeCurrency, (fees.get(transaction.feeCurrency) ?? new Decimal(0)).plus(new Decimal(transaction.feeAmount).abs()));
  }
  return {
    transactions: records.map((transaction) => ({
      transactionId: transaction.paypalTransactionId,
      transactionType: transaction.transactionType,
      status: transaction.status,
      date: transaction.transactionDate,
      transactionFee: {
        amount: transaction.feeAmount,
        currency: transaction.feeCurrency,
        source: transaction.feeSource,
      },
      conversion: transaction.conversion,
    })),
    actualFeesByCurrency: [...fees].map(([currency, amount]) => ({ currency, amount: formatCurrencyAmount(amount, currency), source: "actual_paypal" })),
    conversionCost: { status: "unavailable", reason: "PayPal conversion costs are not returned or verified for these records." },
    withdrawalFees: { status: "unavailable", reason: "No verified withdrawal fee data is available." },
    limit: 500,
  };
}

export async function monthlyAnalytics(userId: string) {
  const filter = await sharedPaypalDataFilter(userId);
  return monthlyIncome({ $and: [filter, confirmedPaymentFilter] });
}

export async function clientAnalytics(userId: string) {
  const rows = await Transaction.aggregate([
    { $match: { userId: new Types.ObjectId(userId), clientId: { $ne: null } } },
    { $group: {
      _id: { clientId: "$clientId", currency: "$grossCurrency" },
      gross: { $sum: { $convert: { input: "$grossAmount", to: "decimal", onError: "0", onNull: "0" } } },
      count: { $sum: 1 },
    } },
    { $sort: { "_id.clientId": 1 } },
  ]);
  return rows.map((row) => ({ clientId: String(row._id.clientId), currency: row._id.currency, grossAmount: formatCurrencyAmount(new Decimal(String(row.gross)), row._id.currency), transactionCount: row.count }));
}

export async function currencyAnalytics(userId: string) {
  const data = await Transaction.aggregate([
    { $match: { $and: [await sharedPaypalDataFilter(userId), confirmedPaymentFilter] } },
    { $group: { _id: "$grossCurrency", transactionCount: { $sum: 1 }, grossAmount: { $sum: { $convert: { input: "$grossAmount", to: "decimal", onError: "0", onNull: "0" } } } } },
    { $sort: { _id: 1 } },
  ]);
  return data.map((item) => ({ currency: item._id, transactionCount: item.transactionCount, grossAmount: formatCurrencyAmount(new Decimal(String(item.grossAmount)), item._id) }));
}
