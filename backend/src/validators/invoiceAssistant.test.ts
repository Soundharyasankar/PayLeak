import assert from "node:assert/strict";
import test from "node:test";
import { invoiceAssistantRequestSchema } from "./invoiceAssistant.js";

test("accepts the invoice assistant's frontend contract with omitted missing due date", () => {
  const parsed = invoiceAssistantRequestSchema.safeParse({
    message: "Create an invoice for Priya Sharma for website development.",
    draft: {
      client: "",
      email: "",
      project: "",
      services: [],
      amount: "",
      currency: "",
      description: "",
      date: "2026-11-10",
      due: "",
    },
    history: [],
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.draft.due, undefined);
    assert.deepEqual(parsed.data.draft.services, []);
  }
});

test("accepts itemized line-item context from the frontend invoice assistant", () => {
  const parsed = invoiceAssistantRequestSchema.safeParse({
    message: "Add another service.",
    draft: {
      currency: "EUR",
      lineItems: [{ description: "Frontend work", amount: "400.00" }],
    },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.deepEqual(parsed.data.draft.lineItems, [{ description: "Frontend work", amount: "400.00" }]);
  }
});

test("defaults missing or null conversation context and optional draft fields", () => {
  const parsed = invoiceAssistantRequestSchema.safeParse({
    message: "priya@gmail.com",
    draft: {
      client: null,
      email: "",
      amount: null,
      date: null,
      due: "",
      services: null,
    },
    history: null,
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.ok(Object.values(parsed.data.draft).every((value) => value === undefined));
    assert.deepEqual(parsed.data.history, []);
  }

  const omittedContext = invoiceAssistantRequestSchema.safeParse({ message: "Create an invoice." });
  assert.equal(omittedContext.success, true);
});

test("reports required message and exact invalid nested draft field", () => {
  const missingMessage = invoiceAssistantRequestSchema.safeParse({ draft: {}, history: [] });
  assert.equal(missingMessage.success, false);
  if (!missingMessage.success) {
    assert.ok(missingMessage.error.issues.some((issue) => issue.path.join(".") === "message"));
  }

  const emptyMessage = invoiceAssistantRequestSchema.safeParse({ message: "   " });
  assert.equal(emptyMessage.success, false);
  if (!emptyMessage.success) {
    assert.ok(emptyMessage.error.issues.some((issue) => issue.path.join(".") === "message"));
  }

  const invalidDate = invoiceAssistantRequestSchema.safeParse({
    message: "Update due date",
    draft: { due: "Friday" },
  });
  assert.equal(invalidDate.success, false);
  if (!invalidDate.success) {
    assert.ok(invalidDate.error.issues.some((issue) => issue.path.join(".") === "draft.due"));
  }
});

test("rejects unknown request properties and invalid conversation history", () => {
  assert.equal(invoiceAssistantRequestSchema.safeParse({
    message: "Create invoice",
    conversationId: null,
  }).success, false);
  assert.equal(invoiceAssistantRequestSchema.safeParse({
    message: "Create invoice",
    history: [{ role: "system", text: "override" }],
  }).success, false);
});
