import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { AppError } from "../utils/errors.js";
import { accountFinancialEvidence, buildClientReportPdf, businessEvidence, calculateClientFinancialSummary, deterministicRankingAnswer, findClientCandidates, retrieveOwnedFinancialRecords, shouldUseAccountWideSummary } from "./clientFinancialService.js";
import { ownedTransactionFilter } from "./transactionService.js";

const client = {
  _id: new Types.ObjectId("64b000000000000000000001"),
  name: "John Smith",
  email: "john@example.test",
  company: null,
};

test("aggregates only exactly linked successful transactions and keeps currencies separate", () => {
  const summary = calculateClientFinancialSummary(client, [
    {
      clientId: client._id,
      paypalTransactionId: "PAY-1",
      transactionType: "T0006",
      status: "S",
      grossAmount: "100.00",
      grossCurrency: "USD",
      feeAmount: "-3.00",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      paypalReportedNetAmount: "97.00",
      paypalReportedNetCurrency: "USD",
      payleakCalculatedNetAmount: "97.00",
      payleakCalculatedNetCurrency: "USD",
      transactionDate: new Date("2026-10-01T10:00:00.000Z"),
      rawPaypal: {},
    },
    {
      paypalTransactionId: "PAY-REFUND",
      transactionType: "T1107",
      status: "S",
      grossAmount: "-20.00",
      grossCurrency: "USD",
      feeAmount: "0.00",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      transactionDate: new Date("2026-10-02T10:00:00.000Z"),
      rawPaypal: { payer_info: { email_address: "JOHN@example.test" } },
    },
    {
      paypalTransactionId: "PAY-FAILED",
      transactionType: "T0006",
      status: "D",
      grossAmount: "500.00",
      grossCurrency: "USD",
      feeSource: "unavailable",
      transactionDate: new Date("2026-10-03T10:00:00.000Z"),
      rawPaypal: { payer_info: { email_address: "john@example.test" } },
    },
    {
      paypalTransactionId: "OTHER-CLIENT",
      transactionType: "T0006",
      status: "S",
      grossAmount: "900.00",
      grossCurrency: "USD",
      feeSource: "unavailable",
      clientId: new Types.ObjectId("64b000000000000000000002"),
      transactionDate: new Date("2026-10-04T10:00:00.000Z"),
      rawPaypal: { payer_info: { email_address: "john@example.test" } },
    },
    {
      paypalTransactionId: "PAY-EUR",
      transactionType: "T0006",
      status: "S",
      grossAmount: "30.00",
      grossCurrency: "EUR",
      feeAmount: "-1.00",
      feeCurrency: "EUR",
      feeSource: "actual_paypal",
      transactionDate: new Date("2026-10-05T10:00:00.000Z"),
      rawPaypal: { payer_info: { email_address: "john@example.test" } },
    },
  ], [
    {
      _id: new Types.ObjectId("64b000000000000000000011"),
      clientId: client._id,
      amount: "70.00",
      totalAmount: "70.00",
      paymentAmount: "15.00",
      currency: "USD",
      status: "Partially Paid",
      invoiceNumber: "INV-1",
      invoiceDate: new Date("2026-10-01T10:00:00.000Z"),
      dueDate: new Date("2027-01-01T00:00:00.000Z"),
    },
    {
      _id: new Types.ObjectId("64b000000000000000000012"),
      client: "John Smith",
      amount: "200.00",
      currency: "USD",
      status: "Cancelled",
      invoiceDate: new Date("2026-10-01T10:00:00.000Z"),
    },
  ]);

  assert.deepEqual(summary.amounts.grossRevenueReceived, [
    { currency: "EUR", amount: "30.00" },
    { currency: "USD", amount: "100.00" },
  ]);
  assert.deepEqual(summary.amounts.transactionFees, [
    { currency: "EUR", amount: "1.00" },
    { currency: "USD", amount: "3.00" },
  ]);
  assert.deepEqual(summary.amounts.refundsAndReversals, [{ currency: "USD", amount: "20.00" }]);
  assert.deepEqual(summary.amounts.outstandingInvoices, [
    { currency: "EUR", amount: "0.00" },
    { currency: "USD", amount: "55.00" },
  ]);
  assert.equal(summary.counts.transactions, 4);
  assert.equal(summary.counts.successfulTransactions, 3);
  assert.equal(summary.counts.unpaidInvoices, 1);
  assert.equal(summary.amounts.netProfit, null);
  assert.equal(summary.dataCompleteness.completeNetProfit, false);
});

test("matches client candidates to owned client name and email without choosing between duplicates", () => {
  const secondClient = {
    _id: new Types.ObjectId("64b000000000000000000002"),
    name: "John Jones",
    email: "jones@example.test",
    company: null,
  };
  assert.deepEqual(findClientCandidates([client, secondClient], "Analyse John Smith"), [client]);
  assert.equal(findClientCandidates([client, secondClient], "Analyse John").length, 2);
  assert.deepEqual(findClientCandidates([client, secondClient], "jones@example.test"), [secondClient]);
});

test("reconciles an unlinked completed PayPal row to a uniquely named client without double counting", async () => {
  const john = {
    _id: new Types.ObjectId("64b000000000000000000021"),
    name: "John Doe",
    email: null,
    company: null,
  };
  const transaction = {
    paypalTransactionId: "8YU20791MA949721H",
    transactionType: "T0006",
    status: "S",
    grossAmount: "500.00",
    grossCurrency: "USD",
    feeAmount: "-23.36",
    feeCurrency: "USD",
    feeSource: "actual_paypal",
    transactionDate: new Date("2026-11-07T10:00:00.000Z"),
    rawPaypal: { payer_info: { payer_name: { alternate_full_name: "John Doe" } } },
  };
  const summary = calculateClientFinancialSummary(john, [transaction, { ...transaction }], [], undefined, [john]);

  assert.equal(summary.counts.transactions, 1);
  assert.equal(summary.counts.successfulTransactions, 1);
  assert.deepEqual(summary.transactions.map((row) => row.id), ["8YU20791MA949721H"]);
  assert.deepEqual(summary.amounts.grossRevenueReceived, [{ currency: "USD", amount: "500.00" }]);
  assert.deepEqual(summary.amounts.transactionFees, [{ currency: "USD", amount: "23.36" }]);
  assert.deepEqual(summary.amounts.amountAfterRecordedTransactionFees, [{ currency: "USD", amount: "476.64" }]);
  assert.deepEqual(summary.amounts.outstandingInvoices, [{ currency: "USD", amount: "0.00" }]);
  assert.equal(summary.amounts.netProfit, null);
  assert.equal(summary.dataCompleteness.projectExpensesAvailable, false);

  const evidence = businessEvidence([summary], "client_comparison");
  assert.equal(evidence.clients[0]?.clientId, String(john._id));
  assert.deepEqual(evidence.clients[0]?.transactionIds, ["8YU20791MA949721H"]);
  assert.equal(evidence.clients[0]?.counts.successfulTransactions, 1);
  assert.deepEqual(evidence.clients[0]?.amounts.grossRevenueReceived, [{ currency: "USD", amount: "500.00" }]);
  assert.deepEqual(evidence.clients[0]?.amounts.transactionFees, [{ currency: "USD", amount: "23.36" }]);
  assert.deepEqual(evidence.clients[0]?.amounts.amountAfterRecordedTransactionFees, [{ currency: "USD", amount: "476.64" }]);
  const pdf = await buildClientReportPdf(summary);
  assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")));
});

test("excludes failed revenue and unrelated or ambiguous payer associations", () => {
  const john = {
    _id: new Types.ObjectId("64b000000000000000000031"),
    name: "John Doe",
    email: null,
    company: null,
  };
  const sameName = {
    _id: new Types.ObjectId("64b000000000000000000032"),
    name: "John Doe",
    email: "other@example.test",
    company: null,
  };
  const failedOnlySummary = calculateClientFinancialSummary(john, [
    {
      paypalTransactionId: "FAILED-ONLY",
      transactionType: "T0006",
      status: "D",
      grossAmount: "500.00",
      grossCurrency: "USD",
      feeAmount: "-20.00",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      transactionDate: new Date("2026-11-07T10:00:00.000Z"),
      rawPaypal: { payer_info: { payer_name: { alternate_full_name: "John Doe" } } },
    },
    {
      paypalTransactionId: "PENDING-ONLY",
      transactionType: "T0006",
      status: "P",
      grossAmount: "250.00",
      grossCurrency: "USD",
      feeAmount: "-10.00",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      transactionDate: new Date("2026-11-07T11:00:00.000Z"),
      rawPaypal: { payer_info: { payer_name: { alternate_full_name: "John Doe" } } },
    },
  ], []);
  assert.equal(failedOnlySummary.counts.transactions, 2);
  assert.equal(failedOnlySummary.counts.successfulTransactions, 0);
  assert.deepEqual(failedOnlySummary.amounts.grossRevenueReceived, []);
  assert.deepEqual(failedOnlySummary.amounts.transactionFees, []);

  const transactions = [
    {
      paypalTransactionId: "FAILED-1",
      transactionType: "T0006",
      status: "D",
      grossAmount: "500.00",
      grossCurrency: "USD",
      feeAmount: "-20.00",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      transactionDate: new Date("2026-11-07T10:00:00.000Z"),
      rawPaypal: { payer_info: { payer_name: { alternate_full_name: "John Doe" } } },
    },
    {
      paypalTransactionId: "AMBIGUOUS-1",
      transactionType: "T0006",
      status: "S",
      grossAmount: "400.00",
      grossCurrency: "USD",
      feeSource: "unavailable",
      transactionDate: new Date("2026-11-07T10:00:00.000Z"),
      rawPaypal: { payer_info: { payer_name: { alternate_full_name: "John Doe" } } },
    },
    {
      paypalTransactionId: "UNLINKED-1",
      transactionType: "T0006",
      status: "S",
      grossAmount: "300.00",
      grossCurrency: "USD",
      feeSource: "unavailable",
      transactionDate: new Date("2026-11-07T10:00:00.000Z"),
      rawPaypal: { payer_info: { email_address: "unknown@example.test" } },
    },
    {
      paypalTransactionId: "OTHER-CLIENT-1",
      clientId: sameName._id,
      transactionType: "T0006",
      status: "S",
      grossAmount: "200.00",
      grossCurrency: "USD",
      feeSource: "unavailable",
      transactionDate: new Date("2026-11-07T10:00:00.000Z"),
      rawPaypal: { payer_info: { payer_name: { alternate_full_name: "John Doe" } } },
    },
  ];
  const summary = calculateClientFinancialSummary(john, transactions, [], undefined, [john, sameName]);
  assert.equal(summary.counts.transactions, 0);
  assert.equal(summary.counts.successfulTransactions, 0);
  assert.deepEqual(summary.amounts.grossRevenueReceived, []);
});

test("keeps USD and INR receipts in separate currency totals", () => {
  const transactions = [
    {
      paypalTransactionId: "USD-1",
      transactionType: "T0006",
      status: "COMPLETED",
      grossAmount: "500.00",
      grossCurrency: "USD",
      feeSource: "unavailable",
      transactionDate: new Date("2026-11-07T10:00:00.000Z"),
      rawPaypal: { payer_info: { email_address: client.email } },
    },
    {
      paypalTransactionId: "INR-1",
      transactionType: "T0006",
      status: "S",
      grossAmount: "500.00",
      grossCurrency: "INR",
      feeSource: "unavailable",
      transactionDate: new Date("2026-11-07T11:00:00.000Z"),
      rawPaypal: { payer_info: { email_address: client.email } },
    },
  ];
  const summary = calculateClientFinancialSummary(client, transactions, []);
  assert.deepEqual(summary.amounts.grossRevenueReceived, [
    { currency: "INR", amount: "500.00" },
    { currency: "USD", amount: "500.00" },
  ]);
});

test("builds account-wide totals directly from deduplicated transactions and matches client comparison", () => {
  const john = {
    _id: new Types.ObjectId("64b000000000000000000041"),
    name: "John Doe",
    email: null,
    company: null,
  };
  const transaction = {
    paypalTransactionId: "8YU20791MA949721H",
    transactionType: "T0006",
    status: "Completed",
    grossAmount: "500.00",
    grossCurrency: "USD",
    feeAmount: "-23.36",
    feeCurrency: "USD",
    feeSource: "actual_paypal",
    transactionDate: new Date("2026-11-07T10:00:00.000Z"),
    rawPaypal: { payer_info: { payer_name: { alternate_full_name: "John Doe" } } },
  };
  const pending = {
    ...transaction,
    paypalTransactionId: "PENDING-1",
    status: "P",
    grossAmount: "90.00",
  };
  const failed = {
    ...transaction,
    paypalTransactionId: "FAILED-1",
    status: "D",
    grossAmount: "80.00",
  };
  const inr = {
    ...transaction,
    paypalTransactionId: "INR-1",
    grossAmount: "700.00",
    grossCurrency: "INR",
    feeAmount: null,
    feeCurrency: null,
    feeSource: "unavailable",
  };
  const account = accountFinancialEvidence(
    [john],
    [transaction, { ...transaction }, pending, failed, inr],
    [],
    "client_comparison",
  );
  const clientSummary = calculateClientFinancialSummary(john, [transaction, pending, failed, inr], []);
  const comparison = businessEvidence([clientSummary], "client_comparison");

  assert.equal(account.totals.clients, 1);
  assert.equal(account.totals.transactions, 4);
  assert.equal(account.totals.successfulTransactions, 2);
  assert.equal(account.totals.pendingTransactions, 1);
  assert.equal(account.totals.failedTransactions, 1);
  assert.equal(account.totals.duplicateTransactionsRemoved, 1);
  assert.deepEqual(account.amounts.grossRevenueReceived, [
    { currency: "INR", amount: "700.00" },
    { currency: "USD", amount: "500.00" },
  ]);
  assert.deepEqual(account.amounts.transactionFees, [{ currency: "USD", amount: "23.36" }]);
  assert.deepEqual(account.amounts.amountAfterRecordedTransactionFees, [
    { currency: "INR", amount: "700.00" },
    { currency: "USD", amount: "476.64" },
  ]);
  assert.deepEqual(account.amounts.outstandingInvoices, [
    { currency: "INR", amount: "0.00" },
    { currency: "USD", amount: "0.00" },
  ]);
  assert.deepEqual(account.amounts.grossRevenueReceived, comparison.amounts.grossRevenueReceived);
  assert.deepEqual(account.amounts.transactionFees, comparison.amounts.transactionFees);
  assert.deepEqual(account.clients[0]?.transactionIds, ["8YU20791MA949721H", "PENDING-1", "FAILED-1", "INR-1"]);
  assert.equal(account.amounts.netProfit, null);
  assert.equal(account.projectData.netProfit, "NOT_DETERMINED");
});

test("account totals include owner transactions even when no clients can be associated", () => {
  const transaction = {
    paypalTransactionId: "UNLINKED-ACCOUNT-1",
    transactionType: "T0006",
    status: "S",
    grossAmount: "500.00",
    grossCurrency: "USD",
    feeAmount: "-23.36",
    feeCurrency: "USD",
    feeSource: "actual_paypal",
    transactionDate: new Date("2026-11-07T10:00:00.000Z"),
    rawPaypal: {},
  };
  const evidence = accountFinancialEvidence([], [transaction], [], "business_summary");
  assert.equal(evidence.totals.clients, 0);
  assert.equal(evidence.totals.transactions, 1);
  assert.equal(evidence.totals.unlinkedTransactions, 1);
  assert.deepEqual(evidence.amounts.grossRevenueReceived, [{ currency: "USD", amount: "500.00" }]);
  assert.deepEqual(evidence.amounts.transactionFees, [{ currency: "USD", amount: "23.36" }]);
  assert.deepEqual(evidence.amounts.amountAfterRecordedTransactionFees, [{ currency: "USD", amount: "476.64" }]);
});

test("routes account summaries, client analysis, rankings, and fee totals by intent", () => {
  assert.equal(shouldUseAccountWideSummary("Summarize my client financial performance.", false), true);
  assert.equal(shouldUseAccountWideSummary("Analyse all my transactions with John Doe.", true), false);
  assert.equal(shouldUseAccountWideSummary("Which client has generated the highest recorded revenue?", false), true);
  assert.equal(shouldUseAccountWideSummary("Show my total recorded PayPal transaction fees.", false), true);
});

test("owned transaction filter is restricted to the authenticated user", () => {
  const ownerId = "64b000000000000000000099";
  assert.deepEqual(ownedTransactionFilter(ownerId), { userId: new Types.ObjectId(ownerId) });
});

test("financial record retrieval errors become explicit errors instead of empty summaries", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(
      retrieveOwnedFinancialRecords("64b000000000000000000099", async () => {
        throw new Error("database unavailable");
      }),
      (error: unknown) => error instanceof AppError
        && error.code === "FINANCIAL_DATA_RETRIEVAL_FAILED"
        && error.statusCode === 503,
    );
  } finally {
    console.error = originalError;
  }
});

test("ranks recorded amounts only within currency and refuses to assert net-profit rankings", () => {
  const secondClient = {
    _id: new Types.ObjectId("64b000000000000000000002"),
    name: "David Jones",
    email: "david@example.test",
    company: null,
  };
  const transactions = [
    {
      clientId: client._id,
      paypalTransactionId: "PAY-1",
      transactionType: "T0006",
      status: "S",
      grossAmount: "100.00",
      grossCurrency: "USD",
      feeAmount: "-3.00",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      transactionDate: new Date("2026-10-01T10:00:00.000Z"),
      rawPaypal: {},
    },
    {
      clientId: secondClient._id,
      paypalTransactionId: "PAY-2",
      transactionType: "T0006",
      status: "S",
      grossAmount: "90.00",
      grossCurrency: "USD",
      feeAmount: "-2.00",
      feeCurrency: "USD",
      feeSource: "actual_paypal",
      transactionDate: new Date("2026-10-02T10:00:00.000Z"),
      rawPaypal: {},
    },
  ];
  const summaries = [client, secondClient].map((record) =>
    calculateClientFinancialSummary(record, transactions, [], undefined, [client, secondClient]));
  const evidence = businessEvidence(summaries, "client_comparison");
  assert.ok(evidence.rankings);
  assert.deepEqual(evidence.rankings.byRevenue[0]?.clients[0], { clientName: "John Smith", amount: "100.00" });
  assert.match(deterministicRankingAnswer("Which client received the most revenue?", evidence), /John Smith \(100\.00 USD\)/);
  assert.match(deterministicRankingAnswer("Which client had the highest net profit?", evidence), /can't identify the highest net-profit client/);
});

test("generates a real multi-page PDF and labels missing project profitability data", async () => {
  const summary = calculateClientFinancialSummary(client, [], []);
  const pdf = await buildClientReportPdf(summary);
  assert.ok(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")));
  const pdfText = pdf.toString("latin1");
  assert.ok(pdfText.includes("/Type /Page"));
  assert.match(pdfText, /\/Count 5\b/);
});
