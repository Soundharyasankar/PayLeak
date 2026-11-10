import assert from "node:assert/strict";
import test from "node:test";
import { applyInvoiceUpdates, firstMissingInvoiceField, invoiceAssistantReply } from "./invoiceAssistantService.js";
import { Invoice } from "../models/Invoice.js";

const initialDraft = {
  client: "Priya Sharma",
  email: "",
  project: "Website Development",
  services: ["Frontend Development", "Backend Development", "Deployment"],
  amount: "50000",
  currency: "INR",
  description: "Website Development\nFrontend Development\nBackend Development\nDeployment",
  date: "2026-11-10",
  due: "2026-11-15",
};

test("follow-up email preserves invoice context and produces a complete validated draft", () => {
  const updated = applyInvoiceUpdates(initialDraft, { email: "priya@gmail.com" }, "2026-11-10");

  assert.equal(updated.email, "priya@gmail.com");
  assert.equal(updated.client, initialDraft.client);
  assert.equal(updated.amount, "50000");
  assert.equal(updated.currency, "INR");
  assert.deepEqual(updated.services, initialDraft.services);
  assert.equal(firstMissingInvoiceField(updated), null);
});

test("project and services become a description when Gemini omits an explicit description", () => {
  const updated = applyInvoiceUpdates({}, {
    client: "Priya Sharma",
    amount: "50000",
    currency: "INR",
    project: "Website Development",
    services: ["Frontend Development", "Backend Development", "Deployment"],
    dueInDays: 5,
  }, "2026-11-10");

  assert.equal(
    updated.description,
    "Website Development\nFrontend Development\nBackend Development\nDeployment",
  );
  assert.equal(firstMissingInvoiceField({ ...updated, email: "priya@example.com" }), null);
});

test("itemized totals are calculated by the backend and preserve separate service prices", () => {
  const updated = applyInvoiceUpdates({}, {
    client: "John David",
    email: "client@example.com",
    project: "E-commerce website",
    currency: "EUR",
    amount: "1200",
    lineItems: [
      { description: "Frontend work", amount: "400" },
      { description: "Backend development", amount: "350" },
      { description: "Payment gateway integration", amount: "250" },
      { description: "Hosting and deployment", amount: "200" },
    ],
    dueInDays: 10,
  }, "2026-11-10");

  assert.equal(updated.amount, "1200.00");
  assert.equal(updated.due, "2026-11-20");
  assert.deepEqual(updated.services, updated.lineItems?.map(({ description }) => description));
});

test("rejects a stated invoice total that differs from the sum of extracted line items", () => {
  assert.throws(() => applyInvoiceUpdates({}, {
    amount: "1300",
    currency: "EUR",
    lineItems: [{ description: "Development", amount: "1200" }],
  }, "2026-11-10"), (error: unknown) =>
    error instanceof Error
      && "code" in error
      && error.code === "INVOICE_LINE_ITEM_TOTAL_MISMATCH"
      && error.message.includes("EUR 1300")
      && error.message.includes("EUR 1200.00")
      && error.message.includes("Which value should I correct?"));
});

test("itemized service additions, removals, and price changes recalculate the total", () => {
  const itemizedDraft = {
    ...initialDraft,
    amount: "750",
    lineItems: [
      { description: "Frontend work", amount: "400" },
      { description: "Backend development", amount: "350" },
    ],
  };
  const added = applyInvoiceUpdates(itemizedDraft, {
    addService: { description: "Hosting", amount: "50", currency: "INR" },
  }, "2026-11-10");
  assert.equal(added.amount, "800.00");
  assert.equal(added.lineItems?.length, 3);

  const changed = applyInvoiceUpdates(added, {
    updateService: { description: "Frontend work", amount: "450" },
  }, "2026-11-10");
  assert.equal(changed.amount, "850.00");

  const removed = applyInvoiceUpdates(changed, { removeService: "Backend development" }, "2026-11-10");
  assert.equal(removed.amount, "500.00");
  assert.deepEqual(removed.services, ["Frontend work", "Hosting"]);
});

test("currency changes do not silently reuse old line-item amounts", () => {
  assert.throws(() => applyInvoiceUpdates({
    ...initialDraft,
    currency: "EUR",
    lineItems: [{ description: "Development", amount: "100" }],
  }, { currency: "USD" }, "2026-11-10"), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "INVOICE_CURRENCY_REQUIRES_NEW_AMOUNTS");
});

test("currency changes are allowed only after the user confirms replacement amounts", () => {
  const updated = applyInvoiceUpdates({
    ...initialDraft,
    lineItems: [{ description: "Development", amount: "50000" }],
  }, {
    currency: "USD",
    currencyAmountsConfirmed: true,
    amount: "900",
    lineItems: [{ description: "Development", amount: "900" }],
  }, "2026-11-10");
  assert.equal(updated.currency, "USD");
  assert.equal(updated.amount, "900.00");
});

test("a new invoice due date is calculated from the server reference date, not the browser draft date", () => {
  const updated = applyInvoiceUpdates({ date: "2026-11-01" }, {
    dueInDays: 10,
  }, "2026-11-10");
  assert.equal(updated.date, "2026-11-10");
  assert.equal(updated.due, "2026-11-20");
});

test("due-in-days is calculated from invoice date and edits preserve unrelated fields", () => {
  const updated = applyInvoiceUpdates(initialDraft, { dueInDays: 10 }, "2026-11-10");
  assert.equal(updated.due, "2026-11-20");
  assert.equal(updated.amount, "50000");
  assert.equal(updated.currency, "INR");
});

test("adding a priced service uses decimal arithmetic and the existing invoice currency", () => {
  const updated = applyInvoiceUpdates(initialDraft, {
    addService: { description: "UI/UX Design", amount: "5000", currency: "INR" },
  }, "2026-11-10");

  assert.equal(updated.amount, "55000.00");
  assert.ok(updated.services?.includes("UI/UX Design"));
  assert.equal(updated.currency, "INR");
});

test("priced services cannot mix currencies", () => {
  assert.throws(() => applyInvoiceUpdates(initialDraft, {
    addService: { description: "UI/UX Design", amount: "50", currency: "USD" },
  }, "2026-11-10"), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "INVOICE_SERVICE_CURRENCY_MISMATCH");
});

test("description fragments such as a trailing 'The' are removed without dropping service names", () => {
  const updated = applyInvoiceUpdates(initialDraft, { description: "Website development.\nFrontend development\nBackend development\nDeployment\nThe" }, "2026-11-10");
  assert.equal(updated.description, "Website development.\nFrontend development\nBackend development\nDeployment");
});

test("required invoice fields are requested instead of guessed", () => {
  assert.equal(firstMissingInvoiceField({}), "client");
  assert.equal(firstMissingInvoiceField({ client: "Priya Sharma" }), "email");
  assert.equal(firstMissingInvoiceField({ client: "Priya Sharma", email: "priya@example.com", amount: "50000" }), "currency");
  assert.equal(firstMissingInvoiceField({ client: "Priya Sharma", email: "priya@example.com", amount: "50000", currency: "INR" }), "description");
  assert.equal(firstMissingInvoiceField({
    client: "Priya Sharma",
    email: "priya@example.com",
    amount: "50000",
    currency: "INR",
    description: "Website development",
    date: "2026-11-10",
  }), "due");
});

test("asks naturally for the missing client email without losing the understood project", () => {
  const draft = { ...initialDraft, email: "" };
  assert.equal(firstMissingInvoiceField(draft), "email");
  assert.equal(
    invoiceAssistantReply("email", draft),
    "I understood your project details. I need one more detail before saving the PayLeak draft: What is Priya Sharma's email address?",
  );
});

test("local conversational draft sessions have a user-scoped unique index", () => {
  const index = Invoice.schema.indexes().find(([, options]) =>
    options.name === "userId_1_assistantSessionId_1_unique");
  assert.ok(index);
  assert.deepEqual(index[0], { userId: 1, assistantSessionId: 1 });
  assert.equal(index[1].unique, true);
});
