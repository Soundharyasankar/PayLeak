import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/payleak-test";
process.env.JWT_SECRET ??= "test-only-signing-secret-that-is-never-used";
process.env.FRONTEND_URL ??= "http://localhost:5173";
process.env.PAYPAL_MODE = "sandbox";
process.env.PAYPAL_BASE_URL = "https://api-m.sandbox.paypal.com";
process.env.PAYPAL_CLIENT_ID = "test-client-id";
process.env.PAYPAL_CLIENT_SECRET = "test-client-secret";
process.env.PAYPAL_ACCOUNT_OWNER_EMAIL = "";
process.env.PAYPAL_ACCOUNT_OWNER_USER_ID = "";

test("refreshes a rejected access token and reports denied API permissions safely", async () => {
  const originalFetch = globalThis.fetch;
  const { clearPaypalTokenCache, paypalRequest, verifyPaypalApplicationOAuth, verifyPaypalInvoiceOAuth } = await import("./paypalClient.js");
  let tokenRequests = 0;
  let apiRequests = 0;
  const authHeaders: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      tokenRequests += 1;
      return new Response(JSON.stringify({
        access_token: `temporary-token-${tokenRequests}`,
        expires_in: 3600,
        scope: "https://uri.paypal.com/services/reporting/search/read https://uri.paypal.com/services/invoicing/invoices/read https://uri.paypal.com/services/invoicing/invoices/write",
        app_id: "APP-TEST-APP-ID",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    apiRequests += 1;
    authHeaders.push(new Headers(init?.headers).get("Authorization") ?? "");
    if (url.endsWith("/forbidden")) {
      return new Response(JSON.stringify({
        name: "AUTHORIZATION_FAILED",
        message: "Insufficient permissions.",
        debug_id: "SAFE-TEST-ID",
      }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    if (apiRequests === 1) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    clearPaypalTokenCache();
    assert.deepEqual(await paypalRequest("/retry"), { ok: true });
    assert.equal(tokenRequests, 2);
    assert.equal(apiRequests, 2);
    assert.deepEqual(authHeaders, ["Bearer temporary-token-1", "Bearer temporary-token-2"]);

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      await assert.rejects(
        paypalRequest("/forbidden"),
        (error: unknown) => error instanceof Error
          && "code" in error && error.code === "PAYPAL_PERMISSION_DENIED"
          && "statusCode" in error && error.statusCode === 503
          && "details" in error && error.details === undefined,
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(authHeaders.some((header) => header.includes("test-client-secret")), false);
    assert.deepEqual(await verifyPaypalApplicationOAuth(), {
      authenticated: true,
      transactionSearchScope: "present",
      appId: "APP-TEST-APP-ID",
      clientIdLast4: "t-id",
    });
    assert.deepEqual(await verifyPaypalInvoiceOAuth(), {
      authenticated: true,
      invoiceReadScope: "present",
      invoiceWriteScope: "present",
      appId: "APP-TEST-APP-ID",
      clientIdLast4: "t-id",
    });
    assert.equal(tokenRequests, 4, "diagnostics request fresh tokens rather than reusing the cached one");
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
  }
});
