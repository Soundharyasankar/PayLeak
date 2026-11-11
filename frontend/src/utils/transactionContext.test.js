import assert from "node:assert/strict";
import test from "node:test";
import { buildRecentPaymentContext } from "./transactionContext.js";

test("uses a uniquely linked invoice for client and project details", () => {
  const context = buildRecentPaymentContext(
    [{
      id: "transaction-1",
      invoiceReference: "paypal-invoice-1",
      client: "PayPal payer",
      itemDetails: ["Consulting — Phase one"],
    }],
    [{ paypalId: "paypal-invoice-1", client: "Invoice client", project: "Verified project" }],
  );

  assert.deepEqual(context, [{
    id: "transaction-1",
    date: undefined,
    clientName: "Invoice client",
    payerName: null,
    projectName: "Verified project",
    paymentDetails: ["Consulting — Phase one"],
  }]);
});

test("does not infer a client or project from an unmatched payment", () => {
  const context = buildRecentPaymentContext(
    [{ id: "transaction-2", invoiceReference: "missing", client: "PayPal payer" }],
    [{ paypalId: "other-invoice", client: "Unrelated client", project: "Unrelated project" }],
  );

  assert.equal(context[0].clientName, null);
  assert.equal(context[0].payerName, "PayPal payer");
  assert.equal(context[0].projectName, null);
});

test("never displays customer email addresses as client or payer names", () => {
  const context = buildRecentPaymentContext(
    [{
      id: "transaction-4",
      invoiceReference: "invoice-4",
      client: "payer@example.com",
    }],
    [{ paypalId: "invoice-4", client: "client@example.com" }],
  );

  assert.equal(context[0].clientName, null);
  assert.equal(context[0].payerName, null);
});

test("rejects ambiguous invoice matches and preserves transaction details", () => {
  const context = buildRecentPaymentContext(
    [{ id: "transaction-3", invoiceReference: "duplicate", itemDetails: ["Service detail"] }],
    [
      { paypalId: "duplicate", client: "First client" },
      { paypalId: "duplicate", client: "Second client" },
    ],
  );

  assert.equal(context[0].clientName, null);
  assert.deepEqual(context[0].paymentDetails, ["Service detail"]);
});
