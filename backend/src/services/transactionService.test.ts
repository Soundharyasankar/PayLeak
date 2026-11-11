import assert from "node:assert/strict";
import test from "node:test";
import { getTransactionPaymentContext } from "./transactionService.js";

test("extracts invoice references and safe PayPal item details", () => {
  const context = getTransactionPaymentContext({
    transaction_info: { invoice_id: "invoice-1" },
    cart_info: {
      paypal_invoice_id: "paypal-invoice-1",
      item_details: [{
        item_name: "Consulting",
        item_description: "Phase one: contact owner@example.com",
      }],
    },
  });

  assert.deepEqual(context, {
    invoiceReference: "paypal-invoice-1",
    itemDetails: ["Consulting — Phase one: contact [email omitted]"],
  });
});

test("uses a transaction subject when PayPal item details are absent", () => {
  assert.deepEqual(
    getTransactionPaymentContext({ transaction_info: { transaction_subject: "Project milestone" } }),
    { invoiceReference: null, itemDetails: ["Project milestone"] },
  );
});
