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

test("retrieves all pages and deduplicates transaction IDs across the requested range", async () => {
  const originalFetch = globalThis.fetch;
  const { clearPaypalTokenCache } = await import("./paypalClient.js");
  const { getTransactionSearchData } = await import("./paypalService.js");
  let pageRequests = 0;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "temporary-test-token",
        expires_in: 3600,
        scope: "https://uri.paypal.com/services/reporting/search/read",
        app_id: "APP-TEST-APP-ID",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    pageRequests += 1;
    const page = Number(new URL(url).searchParams.get("page"));
    return new Response(JSON.stringify({
      total_items: 2,
      total_pages: 2,
      page,
      page_size: 1,
      transaction_details: [{
        transaction_info: {
          transaction_id: page === 1 ? "transaction-1" : "transaction-1",
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    clearPaypalTokenCache();
    const startDate = new Date("2026-01-01T00:00:00.000Z");
    const endDate = new Date("2026-01-05T00:00:00.000Z");
    const result = await getTransactionSearchData(startDate, endDate);

    assert.equal(pageRequests, 2);
    assert.equal(result.totalItemsReported, 2);
    assert.equal(result.rawRecordsReturned, 2);
    assert.equal(result.items.length, 1);
    assert.equal(result.duplicateTransactionIdsSkipped, 1);
    assert.deepEqual(result.pages.map(({ page, pageSize, transactionDetails }) => ({ page, pageSize, transactionDetails })), [
      { page: 1, pageSize: 1, transactionDetails: 1 },
      { page: 2, pageSize: 1, transactionDetails: 1 },
    ]);
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
  }
});
