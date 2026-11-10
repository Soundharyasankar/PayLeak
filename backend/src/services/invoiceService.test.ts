import assert from "node:assert/strict";
import test from "node:test";
import { Invoice } from "../models/Invoice.ts";
import { assertDeletableLocalInvoiceDraft, createLocalInvoiceDraft, invoiceUpdateMode, synchronizeItemizedDescription } from "./invoiceService.js";

test("PayLeak drafts remain locally editable when a PayPal request ID is pending or stale", () => {
  assert.equal(invoiceUpdateMode({
    source: "payleak",
    status: "Draft",
    paypalRequestId: "pending-paypal-request",
  }), "local");
});

test("PayPal-linked drafts use the PayPal update path", () => {
  assert.equal(invoiceUpdateMode({ source: "paypal", status: "Draft" }), "paypal");
});

test("non-draft invoices cannot be edited", () => {
  assert.throws(
    () => invoiceUpdateMode({ source: "payleak", status: "Sent" }),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "INVOICE_NOT_EDITABLE",
  );
});

test("only unsent local PayLeak drafts without a PayPal invoice can be deleted", () => {
  assert.doesNotThrow(() => assertDeletableLocalInvoiceDraft({
    source: "payleak",
    status: "Draft",
  }));
  assert.doesNotThrow(() => assertDeletableLocalInvoiceDraft({
    source: "payleak",
    status: "Draft",
    paypalRequestId: "stale-request-id",
  }));
  for (const invoice of [
    { source: "payleak", status: "Sent" },
    { source: "payleak", status: "Paid" },
    { source: "paypal", status: "Draft" },
    { source: "payleak", status: "Draft", paypalInvoiceId: "INV-123" },
  ]) {
    assert.throws(
      () => assertDeletableLocalInvoiceDraft(invoice),
      (error: unknown) => error instanceof Error
        && "code" in error
        && ["INVOICE_NOT_DELETABLE", "PAYPAL_INVOICE_NOT_DELETABLE"].includes(String(error.code)),
    );
  }
});

test("itemized description follows added, renamed, and removed line items when it was generated from them", () => {
  assert.equal(
    synchronizeItemizedDescription(
      "Mobile app design\nScreen design\nPrototyping\nRevisions",
      "Mobile app design",
      [{ description: "Screen design" }, { description: "Prototyping" }, { description: "Revisions" }],
      [{ description: "Screen design" }, { description: "UI testing" }, { description: "Revisions" }],
    ),
    "Mobile app design\nScreen design\nUI testing\nRevisions",
  );
});

test("itemized edits remove deleted service lines without discarding custom description text", () => {
  assert.equal(
    synchronizeItemizedDescription(
      "Please deliver the designs.\nPrototyping\nClient review is included.",
      "",
      [{ description: "Prototyping" }],
      [],
    ),
    "Please deliver the designs.\nClient review is included.",
  );
});

test("local invoice drafts persist normalized priced line items and return them for preview", async (context) => {
  const stored: Record<string, unknown> = {
    _id: "507f1f77bcf86cd799439011",
    client: "Anitha",
    email: "client-us415@business.example.com",
    project: "banking website",
    services: [],
    lineItems: [],
    amount: "500",
    currency: "USD",
    description: "banking website",
    invoiceDate: new Date("2026-11-10T00:00:00.000Z"),
    dueDate: new Date("2026-11-12T00:00:00.000Z"),
    status: "Draft",
    source: "payleak",
  };
  context.mock.method(Invoice.collection, "createIndex", (async () => "test-index") as Function);
  context.mock.method(Invoice, "findOneAndUpdate", ((_: unknown, update: { $setOnInsert: Record<string, unknown> }) => {
    Object.assign(stored, update.$setOnInsert);
    return { lean: async () => stored };
  }) as Function);

  const invoice = await createLocalInvoiceDraft("507f1f77bcf86cd799439012", {
    assistantSessionId: "ab2e1533-8526-4d7a-8e54-37d4800ec987",
    client: "Anitha",
    email: "client-us415@business.example.com",
    project: "banking website",
    services: [],
    amount: "500",
    currency: "USD",
    description: "banking website",
    date: new Date("2026-11-10T00:00:00.000Z"),
    due: new Date("2026-11-12T00:00:00.000Z"),
  });

  assert.deepEqual(invoice.lineItems, [{ description: "Banking website development", amount: "500.00" }]);
  assert.equal(invoice.amount, "500.00");
  assert.deepEqual(invoice.services, ["Banking website development"]);
});
