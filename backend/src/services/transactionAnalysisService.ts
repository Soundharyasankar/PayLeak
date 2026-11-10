import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import { CurrencyConversion } from "../models/CurrencyConversion.js";
import { Transaction } from "../models/Transaction.js";
import { AppError } from "../utils/errors.js";
import { formatCurrencyAmount } from "../utils/money.js";
import { generateTransactionExplanation } from "./aiService.js";
import {
  calculatePaypalTransactionValues,
  comparePaypalMoney,
  explainNetMismatch,
  isRefundOrReversal,
  type PaypalMoneyValue,
  type VerificationStatus,
} from "./analytics/paypalCalculationService.js";

type TransactionForAnalysis = {
  _id: unknown;
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
  netVerificationStatus?: VerificationStatus;
  netVerificationDifference?: string | null;
  netVerificationExplanation?: string | null;
  netVerificationReasons?: string[];
  conversion?: {
    source?: string;
    sourceAmount?: string | null;
    sourceCurrency?: string | null;
    targetAmount?: string | null;
    targetCurrency?: string | null;
    exchangeRate?: string | null;
    rateDirection?: string | null;
    convertedAt?: Date | null;
    retrievedAt?: Date | null;
    reference?: string | null;
  } | null;
  withdrawalAmount?: string | null;
  withdrawalCurrency?: string | null;
  withdrawalFeeAmount?: string | null;
  withdrawalFeeCurrency?: string | null;
  finalAmount?: string | null;
  finalCurrency?: string | null;
  transactionDate: Date;
  financialDataStatus: string;
  retrievedAt: Date;
  rawPaypal?: unknown;
  aiAnalysis?: {
    factsHash?: string | null;
    explanation?: string | null;
    insights?: string[];
    recommendations?: string[];
    generatedAt?: Date | null;
  } | null;
};

function amount(value: string | null | undefined) {
  if (value == null) return null;
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

function rawTransactionInfo(rawPaypal: unknown) {
  if (!rawPaypal || typeof rawPaypal !== "object") return null;
  const info = (rawPaypal as { transaction_info?: unknown }).transaction_info;
  return info && typeof info === "object" ? info as Record<string, unknown> : null;
}

function payerName(rawPaypal: unknown) {
  if (!rawPaypal || typeof rawPaypal !== "object") return null;
  const payer = (rawPaypal as { payer_info?: { payer_name?: { alternate_full_name?: unknown } } }).payer_info;
  return typeof payer?.payer_name?.alternate_full_name === "string"
    ? payer.payer_name.alternate_full_name
    : null;
}

function toPaypalMoney(value: string | null | undefined, currency: string | null | undefined): PaypalMoneyValue | null {
  return value != null && currency ? { value, currency_code: currency } : null;
}

function deriveVerification(transaction: TransactionForAnalysis) {
  const info = rawTransactionInfo(transaction.rawPaypal);
  const rawReportedNet = info?.net_amount as PaypalMoneyValue | undefined;
  const reportedNet = toPaypalMoney(
    transaction.paypalReportedNetAmount ?? rawReportedNet?.value,
    transaction.paypalReportedNetCurrency ?? rawReportedNet?.currency_code,
  );
  const gross = { value: transaction.grossAmount, currency_code: transaction.grossCurrency };
  const fee = toPaypalMoney(transaction.feeAmount, transaction.feeCurrency);
  const calculated = calculatePaypalTransactionValues({
    gross,
    fee: transaction.feeSource === "actual_paypal" ? fee : null,
    reportedNet,
    transactionType: transaction.transactionType,
    status: transaction.status,
  });
  const additionalFields = [
    "insurance_amount",
    "shipping_amount",
    "shipping_discount_amount",
    "discount_amount",
  ].filter((field) => info?.[field] != null);
  const reasons = calculated.netVerification.status !== "MATCH"
    ? explainNetMismatch({
      gross,
      fee,
      reportedNet,
      calculatedNet: calculated.calculatedNet,
      transactionType: transaction.transactionType,
      status: transaction.status,
      otherFinancialFields: additionalFields,
    })
    : [];
  return {
    reportedNet,
    calculatedNet: calculated.calculatedNet,
    isRefundOrReversal: calculated.isRefundOrReversal,
    netCalculationApplicable: calculated.netCalculationApplicable,
    netVerification: calculated.netVerification,
    reasons,
  };
}

function formatAmount(value: string | null | undefined, currency: string | null | undefined) {
  const parsed = amount(value);
  if (!parsed || !currency) return null;
  try {
    return formatCurrencyAmount(parsed, currency);
  } catch {
    return parsed.toFixed();
  }
}

function makeAnalysis(transaction: TransactionForAnalysis, ai: {
  explanation: string;
  insights: string[];
  recommendations: string[];
}) {
  const grossAmount = amount(transaction.grossAmount);
  const gross = { value: transaction.grossAmount, currency_code: transaction.grossCurrency };
  const rawFee = amount(transaction.feeAmount);
  const hasActualFee = transaction.feeSource === "actual_paypal"
    && rawFee !== null
    && Boolean(transaction.feeCurrency);
  const feeValue = hasActualFee ? formatAmount(rawFee!.abs().toString(), transaction.feeCurrency) : null;
  const fee = hasActualFee ? { value: feeValue, currency_code: transaction.feeCurrency } : null;
  const verification = deriveVerification(transaction);
  const isPositivePayment = !verification.isRefundOrReversal && Boolean(grossAmount?.greaterThan(0));
  const feeSameCurrency = Boolean(fee && gross.currency_code?.toUpperCase() === fee.currency_code?.toUpperCase());
  const feePercentage = hasActualFee && feeSameCurrency && isPositivePayment && grossAmount
    ? rawFee!.abs().div(grossAmount).times(100).toDecimalPlaces(2).toFixed(2)
    : null;
  const netAfterConfirmedFee = verification.netCalculationApplicable
    ? verification.calculatedNet
    : null;

  const conversion = transaction.conversion;
  const conversionAvailable = Boolean(
    conversion?.source === "actual_paypal"
    && (conversion.targetAmount != null || conversion.exchangeRate != null),
  );
  const conversionData = conversionAvailable ? {
    status: "reported_by_paypal",
    source: "PayPal Transaction Search response",
    sourceAmount: conversion?.sourceAmount ?? null,
    sourceCurrency: conversion?.sourceCurrency ?? null,
    targetAmount: conversion?.targetAmount ?? null,
    targetCurrency: conversion?.targetCurrency ?? null,
    exchangeRate: conversion?.exchangeRate ?? null,
    rateDirection: conversion?.rateDirection ?? null,
    retrievedAt: conversion?.retrievedAt?.toISOString() ?? conversion?.convertedAt?.toISOString() ?? null,
  } : {
    status: "unavailable",
    source: "PayPal did not return conversion information for this transaction",
    sourceAmount: null,
    sourceCurrency: null,
    targetAmount: null,
    targetCurrency: null,
    exchangeRate: null,
    rateDirection: null,
    retrievedAt: null,
  };

  const reportedGrossComparison = comparePaypalMoney(gross, gross);
  const reportedFeeComparison = comparePaypalMoney(
    toPaypalMoney(transaction.feeAmount, transaction.feeCurrency),
    toPaypalMoney(transaction.feeAmount, transaction.feeCurrency),
  );
  const finalPayout = toPaypalMoney(transaction.finalAmount, transaction.finalCurrency);
  const hasWithdrawalRecord = Boolean(transaction.withdrawalAmount && transaction.withdrawalCurrency);
  const reconciliationStatus = verification.netVerification.status === "MISMATCH"
    ? "MISMATCH"
    : verification.netVerification.status === "MATCH"
      ? "PARTIALLY_RECONCILED"
      : "INCOMPLETE";
  const reconciliationExplanation = verification.netVerification.status === "MATCH"
    ? "The available PayPal net value matches PayLeak's independent calculation; withdrawal or bank settlement is not verified."
    : verification.netVerification.status === "MISMATCH"
      ? "PayPal's reported net does not match the independent calculation. Review the discrepancy reasons and additional PayPal fields."
      : "PayPal net verification or settlement data is unavailable, so the complete transaction cannot be reconciled.";

  return {
    transactionId: transaction.paypalTransactionId,
    transaction: {
      payer: payerName(transaction.rawPaypal),
      transactionType: transaction.transactionType,
      status: transaction.status,
      date: transaction.transactionDate.toISOString(),
      kind: verification.isRefundOrReversal ? "refund_or_reversal" : "payment_or_other",
    },
    reportedValues: {
      gross: { amount: transaction.grossAmount, currency: transaction.grossCurrency, source: "PayPal Transaction Search" },
      fee: {
        amount: transaction.feeAmount,
        currency: transaction.feeCurrency,
        displayAmount: feeValue,
        source: hasActualFee ? "PayPal Transaction Search" : "Unavailable",
      },
      net: verification.reportedNet
        ? { amount: verification.reportedNet.value, currency: verification.reportedNet.currency_code, source: "PayPal Transaction Search" }
        : null,
      conversion: conversionData,
      withdrawal: hasWithdrawalRecord
        ? { amount: transaction.withdrawalAmount, currency: transaction.withdrawalCurrency, source: "PayPal transaction record" }
        : null,
      finalPayout: finalPayout ? { amount: finalPayout.value, currency: finalPayout.currency_code, source: "PayPal transaction record" } : null,
    },
    calculatedValues: {
      gross: { amount: transaction.grossAmount, currency: transaction.grossCurrency },
      feeInput: hasActualFee ? { amount: transaction.feeAmount, currency: transaction.feeCurrency } : null,
      net: verification.calculatedNet,
      netDifference: verification.netVerification.difference
        ? { amount: verification.netVerification.difference, currency: verification.reportedNet?.currency_code ?? verification.calculatedNet?.currency_code ?? null }
        : null,
      exchangeRate: null,
      finalPayout: null,
    },
    verification: {
      gross: { status: reportedGrossComparison.status, difference: reportedGrossComparison.difference },
      fee: { status: reportedFeeComparison.status, difference: reportedFeeComparison.difference },
      net: {
        status: verification.netVerification.status,
        difference: verification.netVerification.difference,
        explanation: verification.netVerification.explanation,
        reasons: verification.reasons,
      },
      exchangeRate: { status: conversionAvailable ? "NOT_APPLICABLE" as const : "NOT_AVAILABLE" as const, difference: null },
      finalPayout: { status: finalPayout ? "NOT_APPLICABLE" as const : "NOT_AVAILABLE" as const, difference: null },
    },
    overview: {
      grossAmount: { value: transaction.grossAmount, currency: transaction.grossCurrency },
      fee: { value: feeValue, currency: transaction.feeCurrency, source: hasActualFee ? "PayPal Transaction Search" : "unavailable" },
      feePercentageOfGross: feePercentage,
      reportedNet: verification.reportedNet
        ? { value: verification.reportedNet.value, currency: verification.reportedNet.currency_code }
        : null,
      calculatedNet: verification.calculatedNet,
      netVerificationStatus: verification.netVerification.status,
      conversion: conversionData,
      withdrawal: {
        amount: transaction.withdrawalAmount ?? null,
        currency: transaction.withdrawalCurrency ?? null,
        feeAmount: formatAmount(transaction.withdrawalFeeAmount, transaction.withdrawalFeeCurrency),
        feeCurrency: transaction.withdrawalFeeCurrency ?? null,
        status: hasWithdrawalRecord ? "reported_by_paypal" : "unavailable",
      },
      finalPayout: finalPayout ? { value: finalPayout.value, currency: finalPayout.currency_code } : null,
      financialDataStatus: transaction.financialDataStatus,
      retrievedAt: transaction.retrievedAt.toISOString(),
    },
    deductions: [
      {
        type: "PayPal transaction fee",
        amount: feeValue,
        currency: hasActualFee ? transaction.feeCurrency : null,
        percentageOfOriginal: feePercentage,
        source: hasActualFee ? "PayPal Transaction Search response" : "Unavailable in the PayPal transaction record",
        status: hasActualFee ? "verified_by_paypal" : "unavailable",
      },
      {
        type: "Currency conversion",
        amount: null,
        currency: null,
        percentageOfOriginal: null,
        source: conversionAvailable ? "PayPal provided the exchange details; no margin is inferred" : "PayPal conversion information not available for this transaction.",
        status: conversionAvailable ? "reported_by_paypal" : "unavailable",
      },
      {
        type: "Withdrawal fee",
        amount: formatAmount(transaction.withdrawalFeeAmount, transaction.withdrawalFeeCurrency),
        currency: transaction.withdrawalFeeCurrency ?? null,
        percentageOfOriginal: null,
        source: transaction.withdrawalFeeAmount ? "Stored PayPal transaction data" : "PayPal withdrawal or settlement record not available.",
        status: transaction.withdrawalFeeAmount ? "recorded" : "unavailable",
      },
    ],
    moneyFlow: [
      { stage: "PayPal gross transaction amount", amount: transaction.grossAmount, currency: transaction.grossCurrency, status: "verified_by_paypal" },
      { stage: "PayPal transaction fee", amount: feeValue, currency: hasActualFee ? transaction.feeCurrency : null, status: hasActualFee ? "verified_by_paypal" : "unavailable" },
      { stage: "PayLeak calculated net", amount: verification.calculatedNet?.value ?? null, currency: verification.calculatedNet?.currency_code ?? null, status: verification.calculatedNet ? "calculated" : "unavailable" },
      { stage: "PayPal reported net", amount: verification.reportedNet?.value ?? null, currency: verification.reportedNet?.currency_code ?? null, status: verification.reportedNet ? "verified_by_paypal" : "unavailable" },
      { stage: "PayPal conversion", amount: conversionAvailable ? conversion?.targetAmount ?? null : null, currency: conversionAvailable ? conversion?.targetCurrency ?? null : null, status: conversionAvailable ? "verified_by_paypal" : "unavailable" },
      { stage: "PayPal withdrawal or settlement", amount: hasWithdrawalRecord ? transaction.withdrawalAmount : null, currency: hasWithdrawalRecord ? transaction.withdrawalCurrency : null, status: hasWithdrawalRecord ? "recorded" : "unavailable" },
      { stage: "PayPal final payout", amount: finalPayout?.value ?? null, currency: finalPayout?.currency_code ?? null, status: finalPayout ? "verified_by_paypal" : "unavailable" },
    ],
    confirmedLoss: hasActualFee
      ? { amount: feeValue, currency: transaction.feeCurrency, status: "verified_by_paypal" }
      : { amount: null, currency: null, status: "unavailable" },
    unavailableCosts: [
      ...(!conversionAvailable ? ["PayPal conversion information not available for this transaction."] : []),
      ...(!hasWithdrawalRecord ? ["PayPal withdrawal or settlement record not available."] : []),
    ],
    reconciliation: {
      status: reconciliationStatus,
      explanation: reconciliationExplanation,
      netVerification: verification.netVerification.status,
      complete: reconciliationStatus === "PARTIALLY_RECONCILED"
        && hasWithdrawalRecord
        && finalPayout !== null,
    },
    ai,
    source: "PayPal Transaction Search response and PayLeak deterministic calculation",
  };
}

export function buildTransactionFinancialAnalysis(transaction: TransactionForAnalysis, ai = {
  explanation: "",
  insights: [] as string[],
  recommendations: [] as string[],
}) {
  return makeAnalysis(transaction, ai);
}

export async function analyzeOwnedTransaction(userId: string, transactionId: string, regenerate = false) {
  const transaction = await Transaction.findOne({ userId, paypalTransactionId: transactionId }).lean();
  if (!transaction) throw new AppError(404, "Transaction not found.", "TRANSACTION_NOT_FOUND");
  const separateConversion = await CurrencyConversion.findOne({
    userId,
    transactionId: transaction._id,
    sourceStatus: "actual_paypal",
  }).sort({ retrievedAt: -1 }).lean();
  const embeddedConversion = transaction.conversion;
  const conversion = embeddedConversion?.source === "actual_paypal"
    ? embeddedConversion
    : separateConversion
      ? {
        source: "actual_paypal",
        sourceAmount: separateConversion.sourceAmount,
        sourceCurrency: separateConversion.sourceCurrency,
        targetAmount: separateConversion.targetAmount,
        targetCurrency: separateConversion.targetCurrency,
        exchangeRate: separateConversion.exchangeRate,
        rateDirection: separateConversion.rateDirection,
        convertedAt: separateConversion.convertedAt,
        retrievedAt: separateConversion.retrievedAt,
        reference: separateConversion.paypalReference,
      }
      : embeddedConversion;
  const rawInfo = rawTransactionInfo(transaction.rawPaypal);
  const transactionForAnalysis: TransactionForAnalysis = {
    ...transaction,
    paypalReportedNetAmount: transaction.paypalReportedNetAmount
      ?? (rawInfo?.net_amount as PaypalMoneyValue | undefined)?.value ?? null,
    paypalReportedNetCurrency: transaction.paypalReportedNetCurrency
      ?? (rawInfo?.net_amount as PaypalMoneyValue | undefined)?.currency_code ?? null,
    conversion,
  };
  const calculated = deriveVerification(transactionForAnalysis);
  const grossAmount = amount(transaction.grossAmount);
  const feeAmount = amount(transaction.feeAmount);
  const feePercentageOfGross = transaction.feeSource === "actual_paypal"
    && feeAmount !== null
    && transaction.feeCurrency?.toUpperCase() === transaction.grossCurrency.toUpperCase()
    && grossAmount?.greaterThan(0)
    && !calculated.isRefundOrReversal
    ? feeAmount.abs().div(grossAmount).times(100).toDecimalPlaces(2).toFixed(2)
    : null;
  const currentFacts = {
    transaction: {
      payer: payerName(transaction.rawPaypal),
      type: transaction.transactionType,
      status: transaction.status,
      date: transaction.transactionDate.toISOString(),
      isRefundOrReversal: calculated.isRefundOrReversal,
    },
    paypalReported: {
      gross: { amount: transaction.grossAmount, currency: transaction.grossCurrency },
      fee: { amount: transaction.feeAmount, currency: transaction.feeCurrency, source: transaction.feeSource },
      feePercentageOfGross,
      net: calculated.reportedNet,
      conversion,
      withdrawal: {
        amount: transaction.withdrawalAmount ?? null,
        currency: transaction.withdrawalCurrency ?? null,
        feeAmount: transaction.withdrawalFeeAmount ?? null,
        feeCurrency: transaction.withdrawalFeeCurrency ?? null,
      },
      finalAmount: { amount: transaction.finalAmount ?? null, currency: transaction.finalCurrency ?? null },
    },
    payleakCalculated: {
      net: calculated.calculatedNet,
      netVerification: calculated.netVerification,
      discrepancyReasons: calculated.reasons,
    },
  };
  const factsHash = createHash("sha256").update(JSON.stringify(currentFacts)).digest("hex");
  let ai: { explanation: string; insights: string[]; recommendations: string[] };
  const cached = transaction.aiAnalysis;
  if (!regenerate && cached?.factsHash === factsHash && cached.explanation
    && cached.insights?.length && cached.recommendations?.length) {
    ai = {
      explanation: cached.explanation,
      insights: cached.insights,
      recommendations: cached.recommendations,
    };
  } else {
    ai = await generateTransactionExplanation(currentFacts, regenerate);
    await Transaction.updateOne(
      { _id: transaction._id, userId },
      {
        $set: {
          aiAnalysis: {
            factsHash,
            ...ai,
            generatedAt: new Date(),
          },
        },
      },
    );
  }

  const result = makeAnalysis(transactionForAnalysis, ai);
  const net = calculated.calculatedNet;
  await Transaction.updateOne(
    { _id: transaction._id, userId },
    {
      $set: {
        payleakCalculatedNetAmount: net?.value ?? null,
        payleakCalculatedNetCurrency: net?.currency_code ?? null,
        netVerificationStatus: calculated.netVerification.status,
        netVerificationDifference: calculated.netVerification.difference,
        netVerificationExplanation: calculated.netVerification.explanation,
        netVerificationReasons: calculated.reasons,
      },
    },
  );
  return result;
}
