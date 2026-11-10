import assert from "node:assert/strict";
import test from "node:test";
import { assertDeletableLocalInvoiceDraft, invoiceUpdateMode, synchronizeItemizedDescription } from "./invoiceService.js";

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
