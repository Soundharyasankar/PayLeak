import assert from "node:assert/strict";
import test from "node:test";
import { applyInvoiceUpdates, firstMissingInvoiceField, invoiceAiResultToDraft, invoiceAssistantReply } from "./invoiceAssistantService.js";
import { Invoice } from "../models/Invoice.js";
import { invoiceAssistantDraftSchema } from "../validators/invoiceAssistant.js";

const initialDraft = {
  client: "Priya Sharma",
  email: "",
  project: "Website Development",
  services: ["Frontend Development", "Backend Development", "Deployment"],
  lineItems: [
    { description: "Frontend Development", amount: "15000" },
    { description: "Backend Development", amount: "20000" },
    { description: "Deployment", amount: "15000" },
  ],
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
  assert.equal(updated.amount, "50000.00");
  assert.equal(updated.currency, "INR");
  assert.deepEqual(updated.services, initialDraft.services);
  assert.equal(firstMissingInvoiceField(updated), null);
});

test("project and services become a description without inventing invoice item prices or quantities", () => {
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
  assert.equal(firstMissingInvoiceField({ ...updated, email: "priya@example.com" }), "amount");
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
  assert.equal(updated.amount, "50000.00");
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
    lineItems: [{ description: "Website development", amount: "50000" }],
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

test("Groq invoice validation requires a real client email before draft creation", () => {
  const result = invoiceAiResultToDraft(initialDraft, {
    status: "needs_info",
    follow_up_question: "What is Priya Sharma's client email address?",
    missing_fields: ["client_email"],
    invoice: {
      client_name: "Priya Sharma",
      client_email: null,
      project_name: "Website Development",
      currency: "INR",
      due_date: "2026-11-15",
      total_amount: 50000,
      items: [{ name: "Website development", description: "Responsive business website", quantity: 1, unit_price: 50000 }],
    },
    assistant_message: "I have the invoice details so far.",
  }, "2026-11-12");

  assert.equal(firstMissingInvoiceField(result.draft, "2026-11-12"), "email");
});

test("Groq invoice validation rejects a negative item price", () => {
  assert.throws(() => invoiceAiResultToDraft({}, {
    status: "complete",
    follow_up_question: null,
    missing_fields: [],
    invoice: {
      client_name: "Priya Sharma",
      client_email: "priya@example.com",
      project_name: "Website Development",
      currency: "INR",
      due_date: "2026-11-15",
      total_amount: 50000,
      items: [{ name: "Website development", description: "Responsive business website", quantity: 1, unit_price: -50000 }],
    },
    assistant_message: "The invoice is ready.",
  }, "2026-11-12"), (error: unknown) =>
    error instanceof Error && "code" in error && error.code === "INVOICE_ITEM_INVALID");
});

test("Groq invoice validation requires a due date that is not in the past", () => {
  const result = invoiceAiResultToDraft({}, {
    status: "complete",
    follow_up_question: null,
    missing_fields: [],
    invoice: {
      client_name: "Priya Sharma",
      client_email: "priya@example.com",
      project_name: "Website Development",
      currency: "INR",
      due_date: "2026-11-11",
      total_amount: 50000,
      items: [{ name: "Website development", description: "Responsive business website", quantity: 1, unit_price: 50000 }],
    },
    assistant_message: "The invoice is ready.",
  }, "2026-11-12");

  assert.equal(firstMissingInvoiceField(result.draft, "2026-11-12"), "due");
});

test("Groq invoice validation calculates line and invoice totals in backend code", () => {
  const result = invoiceAiResultToDraft({}, {
    status: "complete",
    follow_up_question: null,
    missing_fields: [],
    invoice: {
      client_name: "Priya Sharma",
      client_email: "priya@example.com",
      project_name: "Website Development",
      currency: "INR",
      due_date: "2026-11-15",
      total_amount: 10000,
      items: [
        { name: "Design", description: "Responsive website design", quantity: 2, unit_price: 1500 },
        { name: "Development", description: "Frontend and backend development", quantity: 1, unit_price: 7000 },
      ],
    },
    assistant_message: "The invoice is ready.",
  }, "2026-11-12");

  assert.equal(result.draft.amount, "10000.00");
  assert.deepEqual(result.draft.lineItems, [
    { description: "Responsive website design", amount: "3000" },
    { description: "Frontend and backend development", amount: "7000" },
  ]);
  assert.equal(firstMissingInvoiceField(result.draft, "2026-11-12"), null);
});

test("a stated invoice total consolidates unpriced services into one backend-priced item", () => {
  const result = invoiceAiResultToDraft({}, {
    status: "needs_info",
    follow_up_question: "What are the individual service prices?",
    missing_fields: ["item_price", "item_quantity"],
    invoice: {
      client_name: "Priya",
      client_email: "client-us404@business.example.com",
      project_name: "Website development",
      currency: "USD",
      due_date: "2026-11-17",
      total_amount: 50000,
      items: [
        { name: "Frontend development", description: "Frontend development", quantity: null, unit_price: null },
        { name: "Backend development", description: "Backend development", quantity: null, unit_price: null },
        { name: "Deployment", description: "Deployment", quantity: null, unit_price: null },
      ],
    },
    assistant_message: "The invoice details are ready.",
  }, "2026-11-12");

  assert.equal(result.totalMismatch, undefined);
  assert.equal(result.draft.amount, "50000.00");
  assert.equal(result.draft.currency, "USD");
  assert.equal(result.draft.email, "client-us404@business.example.com");
  assert.equal(result.draft.due, "2026-11-17");
  assert.equal(result.draft.lineItems?.length, 1);
  assert.equal(result.draft.lineItems?.[0]?.description, "Website Development Services: Frontend development, Backend development, and Deployment.");
  assert.equal(result.draft.lineItems?.[0]?.amount, "50000");
  assert.equal(firstMissingInvoiceField(result.draft, "2026-11-12"), null);
});

test("keeps details when a service label plus its detail would exceed the line-item limit", () => {
  const detail = "Homepage wireframing and visual design, responsive frontend implementation, server-side backend configuration, database integration, production deployment, and post-launch smoke checks.";
  const result = invoiceAiResultToDraft({}, {
    status: "complete",
    follow_up_question: null,
    missing_fields: [],
    invoice: {
      client_name: "Rahul Sharma",
      client_email: "client@example.com",
      project_name: "Website development",
      currency: "INR",
      due_date: "2026-11-19",
      total_amount: 45000,
      items: [{ name: "Website development services", description: detail, quantity: 1, unit_price: 45000 }],
    },
    assistant_message: "Invoice details are ready.",
  }, "2026-11-12");

  assert.equal(result.draft.lineItems?.[0]?.description, detail);
  assert.ok((result.draft.lineItems?.[0]?.description.length ?? 201) <= 200);
  assert.ok((result.draft.services?.[0]?.length ?? 201) <= 200);
  assert.ok(result.draft.description?.includes(detail));
  assert.equal(invoiceAssistantDraftSchema.safeParse(result.draft).success, true);
});

test("a long combined service summary uses a concise line item without losing individual service details", () => {
  const items = [
    { name: "Homepage design", description: "Homepage design and responsive visual layout for desktop, tablet, and mobile visitors.", quantity: null, unit_price: null },
    { name: "Frontend development", description: "Accessible frontend development with responsive page components and validated user interactions.", quantity: null, unit_price: null },
    { name: "Backend setup", description: "Backend service configuration, API integration, and secure database connectivity for the website.", quantity: null, unit_price: null },
    { name: "Deployment", description: "Production deployment, domain configuration, and post-launch smoke checks for the completed website.", quantity: null, unit_price: null },
  ];
  const result = invoiceAiResultToDraft({}, {
    status: "complete",
    follow_up_question: null,
    missing_fields: [],
    invoice: {
      client_name: "Rahul Sharma",
      client_email: "client@example.com",
      project_name: "Website development",
      currency: "INR",
      due_date: "2026-11-19",
      total_amount: 45000,
      items,
    },
    assistant_message: "Invoice details are ready.",
  }, "2026-11-12");

  assert.equal(result.draft.lineItems?.length, 1);
  assert.ok((result.draft.lineItems?.[0]?.description.length ?? 201) <= 200);
  assert.match(result.draft.lineItems?.[0]?.description ?? "", /Homepage design/);
  assert.match(result.draft.lineItems?.[0]?.description ?? "", /Frontend development/);
  assert.match(result.draft.lineItems?.[0]?.description ?? "", /Backend setup/);
  assert.match(result.draft.lineItems?.[0]?.description ?? "", /Deployment/);
  assert.equal(result.draft.services?.length, items.length);
  for (const item of items) {
    assert.ok(result.draft.services?.some((service) => service.includes(item.description)));
    assert.ok(result.draft.description?.includes(item.description));
  }
  assert.equal(invoiceAssistantDraftSchema.safeParse(result.draft).success, true);
});

test("a stated total that conflicts with explicit item prices is returned for clarification", () => {
  const result = invoiceAiResultToDraft({}, {
    status: "needs_info",
    follow_up_question: "Which total should I use?",
    missing_fields: ["total_amount"],
    invoice: {
      client_name: "Priya",
      client_email: "priya@example.com",
      project_name: "Website development",
      currency: "USD",
      due_date: "2026-11-17",
      total_amount: 50000,
      items: [
        { name: "Frontend", description: "Frontend development", quantity: 1, unit_price: 20000 },
        { name: "Backend", description: "Backend development", quantity: 1, unit_price: 20000 },
      ],
    },
    assistant_message: "The invoice details are ready.",
  }, "2026-11-12");

  assert.deepEqual(result.totalMismatch, {
    currency: "USD",
    stated: "50000",
    calculated: "40000.00",
  });
  assert.equal(result.draft.lineItems, undefined);
  assert.equal(result.draft.amount, undefined);
  assert.equal(result.draft.client, "Priya");
  assert.equal(result.draft.email, "priya@example.com");
});

test("does not draft an item subtotal when Groq flags an unresolved stated-total conflict", () => {
  const result = invoiceAiResultToDraft({}, {
    status: "needs_info",
    follow_up_question: "The item prices total USD 45,000, but you stated USD 50,000. Which amount should be corrected?",
    missing_fields: ["total_amount", "item_price"],
    invoice: {
      client_name: "Priya",
      client_email: "priya@example.com",
      project_name: "Website development",
      currency: "USD",
      due_date: "2026-11-17",
      total_amount: null,
      items: [
        { name: "Frontend", description: "Frontend development", quantity: 1, unit_price: 20000 },
        { name: "Backend", description: "Backend development", quantity: 1, unit_price: 25000 },
      ],
    },
    assistant_message: "Got it.",
  }, "2026-11-12");

  assert.equal(result.requiresAmountClarification, true);
  assert.equal(result.draft.amount, undefined);
  assert.equal(result.draft.lineItems, undefined);
  assert.equal(firstMissingInvoiceField(result.draft, "2026-11-12"), "amount");
});

test("missing total asks for an amount rather than every item field", () => {
  const draft = {
    client: "Priya",
    email: "priya@example.com",
    currency: "USD",
    project: "Website development",
    services: ["Frontend development", "Backend development", "Deployment"],
    description: "Website development",
    date: "2026-11-12",
  };
  assert.equal(firstMissingInvoiceField(draft), "amount");
  assert.match(invoiceAssistantReply("amount", draft), /What is the invoice total/);
});

test("a follow-up with null extracted fields preserves prior invoice context", () => {
  const priorDraft = {
    client: "Priya",
    email: "client-us404@business.example.com",
    project: "Website development",
    services: ["Frontend development", "Backend development", "Deployment"],
    lineItems: [{ description: "Website Development Services: Frontend development, Backend development, and Deployment.", amount: "50000" }],
    amount: "50000.00",
    currency: "USD",
    description: "Website development\nFrontend development\nBackend development\nDeployment",
    date: "2026-11-12",
    due: "2026-11-17",
  };
  const result = invoiceAiResultToDraft(priorDraft, {
    status: "needs_info",
    follow_up_question: "Please confirm the date.",
    missing_fields: ["due_date"],
    invoice: {
      client_name: null,
      client_email: null,
      project_name: null,
      currency: null,
      due_date: null,
      total_amount: null,
      items: [],
    },
    assistant_message: "One detail is needed.",
  }, "2026-11-12");

  assert.equal(result.draft.client, priorDraft.client);
  assert.equal(result.draft.email, priorDraft.email);
  assert.equal(result.draft.project, priorDraft.project);
  assert.equal(result.draft.amount, priorDraft.amount);
  assert.equal(result.draft.currency, priorDraft.currency);
  assert.equal(result.draft.date, priorDraft.date);
  assert.equal(result.draft.due, priorDraft.due);
  assert.ok(result.draft.services?.join(" ").includes("Frontend development"));
  assert.ok(result.draft.services?.join(" ").includes("Backend development"));
  assert.ok(result.draft.services?.join(" ").includes("Deployment"));
  assert.ok(result.draft.lineItems?.[0]?.description.includes("Deployment"));
  assert.equal(firstMissingInvoiceField(result.draft, "2026-11-12"), null);
});

test("local conversational draft sessions have a user-scoped unique index", () => {
  const index = Invoice.schema.indexes().find(([, options]) =>
    options.name === "userId_1_assistantSessionId_1_unique");
  assert.ok(index);
  assert.deepEqual(index[0], { userId: 1, assistantSessionId: 1 });
  assert.equal(index[1].unique, true);
});
