import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@google/genai";
import {
  financialContextFilters,
  parseInvoiceUnderstandingResponse,
  toFriendlyError,
  toGeminiHistory,
} from "./aiService.js";

test("financial collection filters all bind to the authenticated user ID", () => {
  const filters = financialContextFilters("authenticated-user-id");
  assert.deepEqual(filters, {
    transactions: { userId: "authenticated-user-id" },
    invoices: { userId: "authenticated-user-id" },
    currencyConversions: { userId: "authenticated-user-id" },
  });
});

test("maps conversation history to Gemini user and model roles", () => {
  assert.deepEqual(toGeminiHistory([
    { role: "user", text: "Question" },
    { role: "assistant", text: "Answer" },
  ]), [
    { role: "user", parts: [{ text: "Question" }] },
    { role: "model", parts: [{ text: "Answer" }] },
  ]);
});

test("normalizes Gemini's top-level invoice fields and aliases to canonical updates", () => {
  const parsed = parseInvoiceUnderstandingResponse(JSON.stringify({
    clientName: "Priya Sharma",
    project: "Website development",
    totalAmount: 50000,
    currency: "INR",
    dueInDays: 5,
    services: ["Frontend development", "Backend development", "Deployment"],
  }));

  assert.deepEqual(parsed, {
    updates: {
      client: "Priya Sharma",
      project: "Website development",
      amount: "50000",
      currency: "INR",
      dueInDays: 5,
      services: ["Frontend development", "Backend development", "Deployment"],
    },
  });
});

test("normalizes illustrative invoice aliases, mailto links, and priced service items", () => {
  const parsed = parseInvoiceUnderstandingResponse(JSON.stringify({
    clientName: "John David",
    clientEmail: "[client-us401@business.example.com](mailto:client-us401@business.example.com)",
    projectName: "E-commerce website",
    totalAmount: 1200,
    currency: "EUR",
    line_items: [
      { description: "Frontend work", amount: 400 },
      { description: "Backend development", amount: 350 },
      { name: "Payment gateway integration", unitAmount: 250 },
      { description: "Hosting and deployment", amount: 200 },
    ],
    dueInDays: 10,
  }));
  assert.deepEqual(parsed.updates, {
    client: "John David",
    email: "client-us401@business.example.com",
    project: "E-commerce website",
    amount: "1200",
    currency: "EUR",
    lineItems: [
      { description: "Frontend work", amount: "400" },
      { description: "Backend development", amount: "350" },
      { description: "Payment gateway integration", amount: "250" },
      { description: "Hosting and deployment", amount: "200" },
    ],
    dueInDays: 10,
  });
});

test("capitalizes client names only when the extracted name is entirely lowercase", () => {
  const parsed = parseInvoiceUnderstandingResponse(JSON.stringify({
    updates: { client: "john david" },
  }));
  assert.equal(parsed.updates.client, "John David");

  const mixedCase = parseInvoiceUnderstandingResponse(JSON.stringify({
    updates: { client: "McDonald Smith" },
  }));
  assert.equal(mixedCase.updates.client, "McDonald Smith");
});

test("accepts canonical wrapped invoice updates and rejects malformed fields", () => {
  assert.deepEqual(parseInvoiceUnderstandingResponse(JSON.stringify({
    updates: { email: "priya@example.com", currency: "inr" },
  })), { updates: { email: "priya@example.com", currency: "INR" } });

  assert.throws(
    () => parseInvoiceUnderstandingResponse(JSON.stringify({ clientName: "Priya", totalAmount: "fifty" })),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "INVOICE_AI_INVALID_RESPONSE",
  );
});

test("preserves Gemini intent and clarification metadata for safe assistant routing", () => {
  const parsed = parseInvoiceUnderstandingResponse(JSON.stringify({
    intent: "clarify",
    clarificationRequired: true,
    clarificationQuestion: "Should the total be 1,200 or 1,300 EUR?",
    updates: {},
  }));
  assert.equal(parsed.intent, "clarify");
  assert.equal(parsed.clarificationRequired, true);
  assert.equal(parsed.clarificationQuestion, "Should the total be 1,200 or 1,300 EUR?");
});

test("provides safe actionable errors for invalid keys, unavailable models, and quota", () => {
  const invalidKey = toFriendlyError(new ApiError({ status: 400, message: "API key not valid. Secret redacted." }));
  assert.equal(invalidKey.code, "GEMINI_INVALID_KEY");
  assert.equal(invalidKey.message.includes("Secret redacted"), false);

  const unavailableModel = toFriendlyError(new ApiError({ status: 404, message: "Not found" }));
  assert.equal(unavailableModel.code, "GEMINI_MODEL_UNAVAILABLE");

  const quota = toFriendlyError(new ApiError({ status: 429, message: "RESOURCE_EXHAUSTED" }));
  assert.equal(quota.code, "GEMINI_QUOTA_EXCEEDED");
});
