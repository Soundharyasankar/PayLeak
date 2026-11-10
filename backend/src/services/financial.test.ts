import assert from "node:assert/strict";
import test from "node:test";
import { actualFee, calculateNetFromActual, convertUsingPayPalRate } from "./financial.js";
import { currencyPrecision } from "../utils/money.js";
import { buildTransactionFinancialAnalysis } from "./transactionAnalysisService.js";
import { calculatePaypalTransactionValues, comparePaypalMoney, explainNetMismatch } from "./analytics/paypalCalculationService.js";

test("preserves actual PayPal fee and its currency without adding a reference fee", () => {
  assert.deepEqual(actualFee("-44.30", "USD"), { value: "-44.30", currency: "USD", source: "actual_paypal" });
  assert.deepEqual(actualFee(null, null), { value: null, currency: null, source: "unavailable" });
});

test("calculates net only when gross and actual fee use the same currency", () => {
  assert.equal(calculateNetFromActual("1000.00", "USD", "-44.30", "USD"), "955.70");
  assert.equal(calculateNetFromActual("1000.00", "USD", "44.30", "EUR"), null);
  assert.equal(calculateNetFromActual("10.00", "USD", null, null), null);
});

test("applies an explicit PayPal rate direction and target currency precision", () => {
  assert.equal(convertUsingPayPalRate("10.00", "1.25", "base_to_quote", "USD"), "12.50");
  assert.equal(convertUsingPayPalRate("12.50", "1.25", "quote_to_base", "JPY"), "10");
  assert.equal(currencyPrecision("JPY"), 0);
  assert.equal(currencyPrecision("KWD"), 3);
});

test("rejects invalid exchange rates rather than substituting another source", () => {
  assert.throws(() => convertUsingPayPalRate("10.00", "0", "base_to_quote", "USD"));
  assert.throws(() => convertUsingPayPalRate("10.00", "not-a-rate", "base_to_quote", "USD"));
});

test("builds verified transaction amounts and reports net as unavailable when PayPal did not return it", () => {
  const analysis = buildTransactionFinancialAnalysis({
    _id: "transaction-record",
    paypalTransactionId: "PAYPAL-123",
    transactionType: "PAYMENT",
    status: "S",
    grossAmount: "200.00",
    grossCurrency: "USD",
    feeAmount: "-9.56",
    feeCurrency: "USD",
    feeSource: "actual_paypal",
    conversion: { source: "unavailable" },
    transactionDate: new Date("2026-11-09T12:00:00.000Z"),
    financialDataStatus: "incomplete",
    retrievedAt: new Date("2026-11-09T12:30:00.000Z"),
    rawPaypal: { payer_info: { payer_name: { alternate_full_name: "Freelancer client" } } },
  }, {
    explanation: "The reported payment fee is confirmed; settlement details are not present.",
    insights: ["The transaction fee is the only confirmed deduction."],
    recommendations: ["Compare any conversion using a dated independent rate."],
  });

  assert.equal(analysis.overview.fee.value, "9.56");
  assert.equal(analysis.overview.feePercentageOfGross, "4.78");
  assert.deepEqual(analysis.overview.calculatedNet, { value: "190.44", currency_code: "USD" });
  assert.equal(analysis.overview.reportedNet, null);
  assert.equal(analysis.verification.net.status, "NOT_AVAILABLE");
  assert.equal(analysis.overview.conversion.status, "unavailable");
  assert.equal(analysis.reportedValues.finalPayout, null);
  assert.equal(analysis.confirmedLoss.amount, "9.56");
  assert.equal(analysis.reconciliation.status, "INCOMPLETE");
});

test("does not subtract a PayPal fee denominated in another currency", () => {
  const analysis = buildTransactionFinancialAnalysis({
    _id: "transaction-record",
    paypalTransactionId: "PAYPAL-456",
    transactionType: "PAYMENT",
    status: "S",
    grossAmount: "200.00",
    grossCurrency: "USD",
    feeAmount: "-8.50",
    feeCurrency: "EUR",
    feeSource: "actual_paypal",
    transactionDate: new Date("2026-11-09T12:00:00.000Z"),
    financialDataStatus: "incomplete",
    retrievedAt: new Date("2026-11-09T12:30:00.000Z"),
  }, { explanation: "", insights: [], recommendations: [] });

  assert.equal(analysis.overview.fee.value, "8.50");
  assert.equal(analysis.overview.feePercentageOfGross, null);
  assert.equal(analysis.overview.calculatedNet, null);
});

test("does not describe refunds or reversals as new payments or calculate received net", () => {
  const analysis = buildTransactionFinancialAnalysis({
    _id: "transaction-record",
    paypalTransactionId: "PAYPAL-REFUND",
    transactionType: "REFUND",
    status: "V",
    grossAmount: "-200.00",
    grossCurrency: "USD",
    feeAmount: "0.00",
    feeCurrency: "USD",
    feeSource: "actual_paypal",
    transactionDate: new Date("2026-11-09T12:00:00.000Z"),
    financialDataStatus: "incomplete",
    retrievedAt: new Date("2026-11-09T12:30:00.000Z"),
  }, { explanation: "", insights: [], recommendations: [] });

  assert.equal(analysis.transaction.kind, "refund_or_reversal");
  assert.equal(analysis.overview.calculatedNet, null);
  assert.equal(analysis.overview.feePercentageOfGross, null);
});

test("verifies PayPal reported net against the independent same-currency calculation", () => {
  const match = calculatePaypalTransactionValues({
    gross: { value: "200.00", currency_code: "USD" },
    fee: { value: "-9.56", currency_code: "USD" },
    reportedNet: { value: "190.44", currency_code: "USD" },
    transactionType: "T0006",
    status: "S",
  });
  assert.deepEqual(match.calculatedNet, { value: "190.44", currency_code: "USD" });
  assert.equal(match.netVerification.status, "MATCH");
  assert.equal(match.netVerification.difference, "0.00");

  const mismatch = calculatePaypalTransactionValues({
    gross: { value: "200.00", currency_code: "USD" },
    fee: { value: "-9.56", currency_code: "USD" },
    reportedNet: { value: "189.44", currency_code: "USD" },
    transactionType: "T0006",
    status: "S",
  });
  assert.deepEqual(mismatch.calculatedNet, { value: "190.44", currency_code: "USD" });
  assert.equal(mismatch.netVerification.status, "MISMATCH");
  assert.equal(mismatch.netVerification.difference, "-1.00");
  assert.ok(explainNetMismatch({
    gross: { value: "200.00", currency_code: "USD" },
    fee: { value: "-9.56", currency_code: "USD" },
    reportedNet: { value: "189.44", currency_code: "USD" },
    calculatedNet: mismatch.calculatedNet,
    transactionType: "T0006",
    status: "S",
  }).some((reason) => reason.includes("do not explain")));
});

test("returns reported, calculated, verification, and discrepancy fields in the analysis response", () => {
  const analysis = buildTransactionFinancialAnalysis({
    _id: "transaction-record",
    paypalTransactionId: "PAYPAL-MISMATCH",
    transactionType: "T0006",
    status: "S",
    grossAmount: "200.00",
    grossCurrency: "USD",
    feeAmount: "-9.56",
    feeCurrency: "USD",
    feeSource: "actual_paypal",
    paypalReportedNetAmount: "189.44",
    paypalReportedNetCurrency: "USD",
    conversion: { source: "unavailable" },
    transactionDate: new Date("2026-11-09T12:00:00.000Z"),
    financialDataStatus: "incomplete",
    retrievedAt: new Date("2026-11-09T12:30:00.000Z"),
    rawPaypal: { transaction_info: { net_amount: { value: "189.44", currency_code: "USD" } } },
  });

  assert.equal(analysis.reportedValues.gross.amount, "200.00");
  assert.equal(analysis.reportedValues.net?.amount, "189.44");
  assert.equal(analysis.calculatedValues.net?.value, "190.44");
  assert.equal(analysis.calculatedValues.netDifference?.amount, "-1.00");
  assert.equal(analysis.verification.net.status, "MISMATCH");
  assert.ok(analysis.verification.net.reasons.length > 0);
  assert.equal(analysis.overview.netVerificationStatus, "MISMATCH");
  assert.equal(analysis.reconciliation.status, "MISMATCH");
});

test("does not invent a PayPal net, conversion, or settlement value", () => {
  const result = calculatePaypalTransactionValues({
    gross: { value: "200.00", currency_code: "USD" },
    fee: { value: "-9.56", currency_code: "USD" },
    reportedNet: null,
    transactionType: "T0006",
    status: "S",
  });
  assert.equal(result.netVerification.status, "NOT_AVAILABLE");
  assert.deepEqual(result.calculatedNet, { value: "190.44", currency_code: "USD" });
});

test("does not subtract differently denominated fees or apply payment math to refunds", () => {
  const differentCurrency = calculatePaypalTransactionValues({
    gross: { value: "200.00", currency_code: "USD" },
    fee: { value: "-8.50", currency_code: "EUR" },
    reportedNet: { value: "190.00", currency_code: "USD" },
    transactionType: "T0006",
    status: "S",
  });
  assert.equal(differentCurrency.calculatedNet, null);
  assert.equal(differentCurrency.netVerification.status, "NOT_APPLICABLE");

  const refund = calculatePaypalTransactionValues({
    gross: { value: "-200.00", currency_code: "USD" },
    fee: { value: "0.00", currency_code: "USD" },
    reportedNet: { value: "-200.00", currency_code: "USD" },
    transactionType: "T1107",
    status: "V",
  });
  assert.equal(refund.calculatedNet, null);
  assert.equal(refund.netVerification.status, "NOT_APPLICABLE");
});

test("compares money at currency precision without cross-currency subtraction", () => {
  assert.equal(comparePaypalMoney(
    { value: "100", currency_code: "JPY" },
    { value: "100", currency_code: "JPY" },
  ).status, "MATCH");
  assert.equal(comparePaypalMoney(
    { value: "100.00", currency_code: "USD" },
    { value: "100.00", currency_code: "EUR" },
  ).status, "NOT_APPLICABLE");
});
