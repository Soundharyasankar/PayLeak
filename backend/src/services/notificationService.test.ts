import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { ReminderDraft } from "../models/ReminderDraft.js";
import {
  isInvoiceOverdue,
  isValidReminderEmail,
  MISSING_REMINDER_EMAIL_MESSAGE,
  resolveReminderRecipientFromRecords,
} from "./notificationService.js";

test("validates only explicit recipient email addresses", () => {
  assert.equal(isValidReminderEmail("customer@example.com"), true);
  assert.equal(isValidReminderEmail(" user@example.com "), true);
  assert.equal(isValidReminderEmail(""), false);
  assert.equal(isValidReminderEmail("PayLeak user"), false);
  assert.equal(isValidReminderEmail("customer@localhost"), false);
});

test("resolves a linked client's email before using the invoice recipient snapshot", () => {
  const recipient = resolveReminderRecipientFromRecords(
    {
      clientId: new Types.ObjectId(),
      email: "invoice-contact@example.com",
      customerEmail: null,
      client: "Invoice Client",
    },
    { name: "Registered Client", email: "client@example.com" },
  );
  assert.deepEqual(recipient, { to: "client@example.com", clientName: "Registered Client" });
});

test("uses a valid invoice recipient snapshot and never substitutes another email", () => {
  const recipient = resolveReminderRecipientFromRecords({
    clientId: null,
    email: "invoice-contact@example.com",
    customerEmail: null,
    client: "Invoice Client",
  });
  assert.equal(recipient.to, "invoice-contact@example.com");
  assert.throws(
    () => resolveReminderRecipientFromRecords({
      clientId: null,
      email: "",
      customerEmail: null,
      client: "PayLeak user",
    }),
    (error: unknown) => error instanceof Error && error.message === MISSING_REMINDER_EMAIL_MESSAGE,
  );
});

test("does not use an email address as a generated client name", () => {
  const recipient = resolveReminderRecipientFromRecords({
    clientId: null,
    email: "customer@example.com",
    customerEmail: null,
    client: "customer@example.com",
    customerName: "customer@example.com",
  });
  assert.equal(recipient.to, "customer@example.com");
  assert.equal(recipient.clientName, "");
});

test("does not draft for paid, cancelled, or not-yet-overdue invoices", () => {
  const now = new Date("2026-11-11T13:00:00.000Z");
  assert.equal(isInvoiceOverdue({ status: "Overdue", dueDate: new Date("2026-11-10T00:00:00.000Z") }, now), true);
  assert.equal(isInvoiceOverdue({ status: "Paid", dueDate: new Date("2026-11-10T00:00:00.000Z") }, now), false);
  assert.equal(isInvoiceOverdue({ status: "Cancelled", dueDate: new Date("2026-11-10T00:00:00.000Z") }, now), false);
  assert.equal(isInvoiceOverdue({ status: "Overdue", dueDate: new Date("2026-11-11T00:00:00.000Z") }, now), false);
});

test("enforces one active reminder draft per invoice", () => {
  const uniqueIndexes = ReminderDraft.schema.indexes().filter(([, options]) => options.unique);
  assert.ok(uniqueIndexes.some(([keys]) => keys.invoiceId === 1 && keys.status === 1));
});
