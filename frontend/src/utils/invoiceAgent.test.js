import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceAssistantRequest, createEmptyInvoiceAgent, invoicePayloadFromDraft } from "./invoiceAgent.js";

test("a new invoice workflow gets isolated session and PayPal request IDs with empty state", () => {
  const first = createEmptyInvoiceAgent();
  const second = createEmptyInvoiceAgent();

  assert.notEqual(first.sessionId, second.sessionId);
  assert.notEqual(first.paypalRequestId, second.paypalRequestId);
  assert.deepEqual(first.messages, []);
  assert.equal(first.invoice, null);
  assert.equal(first.paypalError, "");
  assert.equal(first.draft.client, "");
  assert.equal(first.draft.email, "");
  assert.equal(first.draft.amount, "");
  assert.equal(first.draft.currency, "");
  assert.equal(first.draft.due, "");
});

test("assistant request omits empty optional draft values and undefined fields", () => {
  const request = buildInvoiceAssistantRequest(
    "  Create an invoice for Priya Sharma.  ",
    {
      client: "",
      email: null,
      project: "",
      services: [],
      amount: "",
      currency: "",
      description: "",
      date: "2026-11-10",
      due: "",
      extra: undefined,
    },
    [],
  );

  assert.deepEqual(request, {
    message: "Create an invoice for Priya Sharma.",
    draft: { date: "2026-11-10" },
    history: [],
  });
  assert.equal(JSON.stringify(request).includes("undefined"), false);
});

test("assistant request retains existing context and valid conversation turns", () => {
  const request = buildInvoiceAssistantRequest(
    "  priya@gmail.com ",
    { client: "Priya Sharma", currency: "INR", due: null },
    [
      { role: "user", text: " Original invoice request " },
      { role: "assistant", text: " Please provide the email." },
      { role: "system", text: "ignored" },
      { role: "user", text: "" },
    ],
  );

  assert.deepEqual(request, {
    message: "priya@gmail.com",
    draft: { client: "Priya Sharma", currency: "INR" },
    history: [
      { role: "user", text: "Original invoice request" },
      { role: "assistant", text: "Please provide the email." },
    ],
  });
});

test("informal first-turn invoice requests use the strict assistant contract without empty date fields", () => {
  const request = buildInvoiceAssistantRequest(
    "hi, make an invoice for Sarah; mobile app UI design; 300 screen design, 150 prototyping, 100 revisions; total 550 USD; sarah@gmail.com; due in 7 days",
    { date: "2026-11-10", due: "" },
    [],
  );

  assert.deepEqual(request, {
    message: "hi, make an invoice for Sarah; mobile app UI design; 300 screen design, 150 prototyping, 100 revisions; total 550 USD; sarah@gmail.com; due in 7 days",
    draft: { date: "2026-11-10" },
    history: [],
  });
});

test("invoice agent payload preserves structured services, exact amount, currency, and due date", () => {
  const payload = invoicePayloadFromDraft({
    client: "Priya Sharma",
    email: "priya@gmail.com",
    project: "Website Development",
    services: ["Frontend Development", "Backend Development", "Deployment"],
    amount: 50000,
    currency: "INR",
    description: "Website Development\nFrontend Development\nBackend Development\nDeployment",
    date: "2026-11-10",
    due: "2026-11-15",
    internalContext: "not sent",
  });

  assert.deepEqual(payload, {
    client: "Priya Sharma",
    email: "priya@gmail.com",
    project: "Website Development",
    services: ["Frontend Development", "Backend Development", "Deployment"],
    amount: "50000",
    currency: "INR",
    description: "Website Development\nFrontend Development\nBackend Development\nDeployment",
    date: "2026-11-10",
    due: "2026-11-15",
  });
});

test("invoice agent payload preserves priced line items for server-side total calculation", () => {
  const payload = invoicePayloadFromDraft({
    client: "John David",
    email: "john@example.com",
    project: "E-commerce website",
    services: ["Frontend work", "Backend development"],
    lineItems: [
      { description: "Frontend work", amount: "400" },
      { description: "Backend development", amount: "350" },
    ],
    amount: "750",
    currency: "EUR",
    description: "E-commerce website",
    date: "2026-11-10",
    due: "2026-11-20",
  });
  assert.deepEqual(payload.lineItems, [
    { description: "Frontend work", amount: "400" },
    { description: "Backend development", amount: "350" },
  ]);
});

test("assistant and draft requests reject overlong service and line-item descriptions before sending", () => {
  const longDescription = "x".repeat(201);
  assert.throws(() => buildInvoiceAssistantRequest(
    "Update the invoice.",
    { services: [longDescription] },
    [],
  ), /service description must be 200 characters or fewer/);
  assert.throws(() => buildInvoiceAssistantRequest(
    "Update the invoice.",
    { lineItems: [{ description: longDescription, amount: "45000" }] },
    [],
  ), /line-item description must be between 1 and 200 characters/);
  assert.throws(() => invoicePayloadFromDraft({
    services: ["Website development"],
    lineItems: [{ description: longDescription, amount: "45000" }],
  }), /line-item description must be between 1 and 200 characters/);
});

test("valid invoice descriptions are trimmed without truncating their content", () => {
  const detail = "Homepage design, frontend implementation, backend setup, and production deployment";
  const payload = invoicePayloadFromDraft({
    client: "Rahul Sharma",
    email: "client@example.com",
    project: "Website development",
    services: [` ${detail} `],
    lineItems: [{ description: ` ${detail} `, amount: "45000" }],
    amount: "45000",
    currency: "INR",
    description: `Website development\n${detail}`,
    date: "2026-11-12",
    due: "2026-11-19",
  });

  assert.deepEqual(payload.services, [detail]);
  assert.deepEqual(payload.lineItems, [{ description: detail, amount: "45000" }]);
});
