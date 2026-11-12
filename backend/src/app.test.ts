import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/payleak-test";
process.env.JWT_SECRET ??= "test-only-signing-secret-that-is-never-used";
process.env.FRONTEND_URL ??= "http://localhost:5173";
process.env.NODE_ENV = "test";
process.env.GEMINI_API_KEY = "";
process.env.GROQ_API_KEY = "";

test("health and protected route responses use the documented API envelope", async (context) => {
  const { app } = await import("./app.js");
  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const testToken = jwt.sign(
    { email: "invoice-test@example.com" },
    process.env.JWT_SECRET!,
    { subject: "507f1f77bcf86cd799439011" },
  );

  const root = await fetch(`${baseUrl}/`);
  assert.equal(root.status, 200);
  assert.deepEqual(await root.json(), {
    success: true,
    message: "PayLeak API is running",
    status: "healthy",
  });

  const invoicePreflight = await fetch(`${baseUrl}/api/invoices`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "accept,authorization,content-type,idempotency-key",
    },
  });
  assert.equal(invoicePreflight.status, 204);
  assert.equal(invoicePreflight.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(invoicePreflight.headers.get("access-control-allow-credentials"), "true");
  assert.match(invoicePreflight.headers.get("access-control-allow-methods") ?? "", /\bPOST\b/);
  const invoiceAllowedHeaders = invoicePreflight.headers.get("access-control-allow-headers")?.toLowerCase() ?? "";
  for (const header of ["accept", "authorization", "content-type", "idempotency-key"]) {
    assert.ok(invoiceAllowedHeaders.includes(header), `CORS preflight must allow ${header}`);
  }

  const productionLoginPreflight = await fetch(`${baseUrl}/api/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://payleak-1.onrender.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(productionLoginPreflight.status, 204);
  assert.equal(productionLoginPreflight.headers.get("access-control-allow-origin"), "https://payleak-1.onrender.com");
  assert.equal(productionLoginPreflight.headers.get("access-control-allow-credentials"), "true");
  assert.match(productionLoginPreflight.headers.get("access-control-allow-methods") ?? "", /\bPOST\b/);
  assert.match(productionLoginPreflight.headers.get("access-control-allow-headers")?.toLowerCase() ?? "", /\bcontent-type\b/);

  const productionHealth = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "https://payleak-1.onrender.com" },
  });
  assert.equal(productionHealth.headers.get("access-control-allow-origin"), "https://payleak-1.onrender.com");
  assert.equal(productionHealth.headers.get("access-control-allow-credentials"), "true");

  const untrustedOriginPreflight = await fetch(`${baseUrl}/api/invoices`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://untrusted.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(untrustedOriginPreflight.status, 204);
  assert.equal(untrustedOriginPreflight.headers.get("access-control-allow-origin"), null);
  assert.notEqual(untrustedOriginPreflight.headers.get("access-control-allow-origin"), "*");
  assert.notEqual(untrustedOriginPreflight.headers.get("access-control-allow-origin"), "https://untrusted.example");

  const corsProtectedInvoicePost = await fetch(`${baseUrl}/api/invoices`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      "Content-Type": "application/json",
      "Idempotency-Key": "d2719b58-b148-460e-995f-c2357406c060",
    },
    body: JSON.stringify({}),
  });
  assert.equal(corsProtectedInvoicePost.status, 401);
  assert.equal(corsProtectedInvoicePost.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(corsProtectedInvoicePost.headers.get("access-control-allow-credentials"), "true");
  assert.equal((await corsProtectedInvoicePost.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  const healthBody = await health.json() as { success: boolean; data: { databaseName: string | null } };
  assert.equal(healthBody.success, true);
  assert.equal(healthBody.data.databaseName, null);

  const protectedResponse = await fetch(`${baseUrl}/api/transactions`);
  assert.equal(protectedResponse.status, 401);
  assert.equal((await protectedResponse.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedPaypalConfig = await fetch(`${baseUrl}/api/paypal/config`);
  assert.equal(protectedPaypalConfig.status, 401);
  assert.equal((await protectedPaypalConfig.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedPaypalAccount = await fetch(`${baseUrl}/api/paypal/account`);
  assert.equal(protectedPaypalAccount.status, 401);
  assert.equal((await protectedPaypalAccount.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedPaypalDiagnostics = await fetch(`${baseUrl}/api/paypal/diagnostics`, { method: "POST" });
  assert.equal(protectedPaypalDiagnostics.status, 401);
  assert.equal((await protectedPaypalDiagnostics.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedPaypalSync = await fetch(`${baseUrl}/api/paypal/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: "2026-11-01T00:00:00.000Z",
      endDate: "2026-11-11T00:00:00.000Z",
    }),
  });
  assert.equal(protectedPaypalSync.status, 401);
  assert.equal((await protectedPaypalSync.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedInvoiceSync = await fetch(`${baseUrl}/api/invoices/sync-paypal`, { method: "POST" });
  assert.equal(protectedInvoiceSync.status, 401);
  assert.equal((await protectedInvoiceSync.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedInvoiceCreate = await fetch(`${baseUrl}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(protectedInvoiceCreate.status, 401);
  assert.equal((await protectedInvoiceCreate.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedInvoiceAssistant = await fetch(`${baseUrl}/api/invoices/assistant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Create an invoice." }),
  });
  assert.equal(protectedInvoiceAssistant.status, 401);
  assert.equal((await protectedInvoiceAssistant.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const invalidAssistantRequest = await fetch(`${baseUrl}/api/invoices/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${testToken}`,
    },
    body: JSON.stringify({
      message: "Create an invoice.",
      draft: { date: "2026-11-10", due: "Friday" },
    }),
  });
  assert.equal(invalidAssistantRequest.status, 400);
  const invalidAssistantBody = await invalidAssistantRequest.json() as {
    error: { code: string; message: string; details: { issues: Array<{ field: string }> } };
  };
  assert.equal(invalidAssistantBody.error.code, "VALIDATION_ERROR");
  assert.match(invalidAssistantBody.error.message, /draft\.due/);
  assert.ok(invalidAssistantBody.error.details.issues.some((issue) => issue.field === "draft.due"));

  const validAssistantRequest = await fetch(`${baseUrl}/api/invoices/assistant`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${testToken}`,
    },
    body: JSON.stringify({
      message: "Create an invoice for Priya Sharma.",
      draft: { date: "2026-11-10" },
      history: [],
    }),
  });
  assert.equal(validAssistantRequest.status, 503);
  assert.equal((await validAssistantRequest.json() as { error: { code: string } }).error.code, "INVOICE_AI_NOT_CONFIGURED");

  const protectedLocalInvoicePublish = await fetch(`${baseUrl}/api/invoices/507f1f77bcf86cd799439011/paypal`, { method: "POST" });
  assert.equal(protectedLocalInvoicePublish.status, 401);
  assert.equal((await protectedLocalInvoicePublish.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedInvoiceSend = await fetch(`${baseUrl}/api/invoices/507f1f77bcf86cd799439011/send`, { method: "POST" });
  assert.equal(protectedInvoiceSend.status, 401);
  assert.equal((await protectedInvoiceSend.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedInvoiceDiagnostics = await fetch(`${baseUrl}/api/invoices/paypal/diagnostics`, { method: "POST" });
  assert.equal(protectedInvoiceDiagnostics.status, 401);
  assert.equal((await protectedInvoiceDiagnostics.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedAiChat = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Summarize my transactions." }),
  });
  assert.equal(protectedAiChat.status, 401);
  assert.equal((await protectedAiChat.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedFinancialAgent = await fetch(`${baseUrl}/api/ai/financial-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Analyse my client finances." }),
  });
  assert.equal(protectedFinancialAgent.status, 401);
  assert.equal((await protectedFinancialAgent.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedFinancialReport = await fetch(`${baseUrl}/api/ai/reports/507f1f77bcf86cd799439011/download`);
  assert.equal(protectedFinancialReport.status, 401);
  assert.equal((await protectedFinancialReport.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedAiDiagnostics = await fetch(`${baseUrl}/api/ai/diagnostics`, { method: "POST" });
  assert.equal(protectedAiDiagnostics.status, 401);
  assert.equal((await protectedAiDiagnostics.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const protectedOrderCreation = await fetch(`${baseUrl}/api/paypal/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: "1.00", currency: "USD", description: "Test" }),
  });
  assert.equal(protectedOrderCreation.status, 401);
  assert.equal((await protectedOrderCreation.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

  const invalidRegistration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "short" }),
  });
  assert.equal(invalidRegistration.status, 400);
});
