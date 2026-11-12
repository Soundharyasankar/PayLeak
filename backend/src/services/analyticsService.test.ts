import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDashboardTransactions, summarizePaypalInvoices } from "./analyticsService.js";
import { isConfirmedPaymentTransaction } from "./transactionEligibility.js";

test("dashboard counts only confirmed payment records, not account corrections", () => {
  const payments = [
    { transactionType: "T0006", status: "S", grossAmount: "500.00", grossCurrency: "USD", feeAmount: "-23.36", feeCurrency: "USD", feeSource: "actual_paypal", conversion: { source: "unavailable" } },
    { transactionType: "T0006", status: "S", grossAmount: "100.00", grossCurrency: "USD", feeAmount: "-4.96", feeCurrency: "USD", feeSource: "actual_paypal", conversion: { source: "unavailable" } },
    { transactionType: "T0006", status: "S", grossAmount: "50.00", grossCurrency: "USD", feeAmount: "-2.66", feeCurrency: "USD", feeSource: "actual_paypal", conversion: { source: "unavailable" } },
    ...["1", "2", "3"].map(() => ({
      transactionType: "T0006",
      status: "S",
      grossAmount: "200.00",
      grossCurrency: "USD",
      feeAmount: "-9.56",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      conversion: { source: "unavailable" },
    })),
    { transactionType: "PAYMENT_CAPTURE", status: "COMPLETED", grossAmount: "500.00", grossCurrency: "USD", feeAmount: "23.36", feeCurrency: "USD", feeSource: "actual_paypal", conversion: { source: "unavailable" } },
  ];
  const result = summarizeDashboardTransactions([
    ...payments,
    { transactionType: "T1900", status: "S", grossAmount: "5000.00", grossCurrency: "USD", feeAmount: null, feeCurrency: null, feeSource: "unavailable", conversion: { source: "unavailable" } },
    { transactionType: "T0006", status: "P", grossAmount: "900.00", grossCurrency: "USD", feeAmount: null, feeCurrency: null, feeSource: "unavailable", conversion: { source: "unavailable" } },
  ]);

  assert.equal(result.transactionCount, 7);
  assert.deepEqual(result.currencies, [{
    currency: "USD",
    totalGross: "1750.00",
    totalActualFees: "83.02",
    totalNetWhenFeeCurrencyMatches: "1666.98",
    transactionCount: 7,
    feeCountSameCurrency: 7,
    feesUnavailableOrDifferentCurrency: 0,
    netStatus: "complete",
  }]);
  assert.deepEqual(result.feesByCurrency, [{ currency: "USD", actualFees: "83.02", source: "actual_paypal" }]);
});

test("unavailable fees keep the net incomplete rather than implying zero fees", () => {
  const result = summarizeDashboardTransactions([
    { transactionType: "T0006", status: "S", grossAmount: "100.00", grossCurrency: "USD", feeAmount: null, feeCurrency: null, feeSource: "unavailable", conversion: { source: "unavailable" } },
  ]);

  assert.equal(result.currencies[0]?.totalActualFees, "0.00");
  assert.equal(result.currencies[0]?.totalNetWhenFeeCurrencyMatches, "0.00");
  assert.equal(result.currencies[0]?.netStatus, "incomplete");
  assert.equal(result.currencies[0]?.feesUnavailableOrDifferentCurrency, 1);
  assert.equal(result.feesByCurrency.length, 0);
});

test("confirmed-payment classification excludes pending and non-payment events", () => {
  assert.equal(isConfirmedPaymentTransaction({ transactionType: "T0006", status: "S" }), true);
  assert.equal(isConfirmedPaymentTransaction({ transactionType: "PAYMENT_CAPTURE", status: "COMPLETED" }), true);
  assert.equal(isConfirmedPaymentTransaction({ transactionType: "T1900", status: "S" }), false);
  assert.equal(isConfirmedPaymentTransaction({ transactionType: "T0006", status: "P" }), false);
});

test("PayPal open invoice count uses PayPal statuses and excludes local drafts and paid invoices", () => {
  const invoices = [
    ...Array.from({ length: 11 }, () => ({ source: "paypal", status: "Draft" })),
    ...Array.from({ length: 11 }, () => ({ source: "paypal", status: "Sent" })),
    ...Array.from({ length: 15 }, () => ({ source: "paypal", status: "Overdue" })),
    ...Array.from({ length: 6 }, () => ({ source: "paypal", status: "Paid" })),
    ...Array.from({ length: 2 }, () => ({ source: "payleak", status: "Draft" })),
  ];
  const result = summarizePaypalInvoices(invoices);

  assert.equal(result.total, 43);
  assert.equal(result.openCount, 37);
  assert.equal(result.overdueCount, 15);
  assert.equal(result.byStatus.Paid, 6);
});
