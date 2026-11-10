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

test("maps PayPal invoice statuses without inferring payment from transactions", async () => {
  const { mapPaypalInvoiceStatus } = await import("./paypalInvoiceService.js");
  const now = new Date("2026-11-09T12:00:00.000Z");
  const pastDue = new Date("2026-11-08T00:00:00.000Z");
  const dueToday = new Date("2026-11-09T00:00:00.000Z");
  const futureDue = new Date("2026-11-10T00:00:00.000Z");

  assert.equal(mapPaypalInvoiceStatus("DRAFT", futureDue, now), "Draft");
  assert.equal(mapPaypalInvoiceStatus("SENT", futureDue, now), "Sent");
  assert.equal(mapPaypalInvoiceStatus("UNPAID", pastDue, now), "Overdue");
  assert.equal(mapPaypalInvoiceStatus("SENT", dueToday, now), "Sent");
  assert.equal(mapPaypalInvoiceStatus("PARTIALLY_PAID", futureDue, now), "Partially Paid");
  assert.equal(mapPaypalInvoiceStatus("PARTIALLY_PAID", pastDue, now), "Overdue");
  assert.equal(mapPaypalInvoiceStatus("PAID", pastDue, now), "Paid");
  assert.equal(mapPaypalInvoiceStatus("CANCELLED", futureDue, now), "Cancelled");
  assert.equal(mapPaypalInvoiceStatus("REFUNDED", futureDue, now), "Refunded");
  assert.equal(mapPaypalInvoiceStatus("UNKNOWN", futureDue, now), null);
});

test("requests every PayPal Invoicing page and skips repeated invoice IDs", async () => {
  const originalFetch = globalThis.fetch;
  const { clearPaypalTokenCache } = await import("./paypalClient.js");
  const { getAllPaypalInvoicePages } = await import("./paypalInvoiceService.js");
  const requestedPages: number[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "temporary-test-token",
        expires_in: 3600,
        scope: "https://uri.paypal.com/services/invoicing/invoices/read",
        app_id: "APP-TEST-APP-ID",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const requestUrl = new URL(url);
    requestedPages.push(Number(requestUrl.searchParams.get("page")));
    assert.equal(requestUrl.pathname, "/v2/invoicing/invoices");
    assert.equal(requestUrl.searchParams.get("page_size"), "100");
    assert.equal(requestUrl.searchParams.get("total_required"), "true");
    const page = Number(requestUrl.searchParams.get("page"));
    return new Response(JSON.stringify({
      total_items: 3,
      total_pages: 2,
      page,
      items: page === 1 ? [{ id: "invoice-1" }, { id: "invoice-2" }] : [{ id: "invoice-2" }, { id: "invoice-3" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    clearPaypalTokenCache();
    const result = await getAllPaypalInvoicePages();
    assert.deepEqual(requestedPages, [1, 2]);
    assert.equal(result.paypalTotalItems, 3);
    assert.equal(result.paypalTotalPages, 2);
    assert.equal(result.invoices.length, 3);
    assert.equal(result.duplicateInvoicesSkipped, 1);
    assert.deepEqual(result.pages.map((item) => item.returnedItems), [2, 2]);
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
  }
});

test("builds a single-currency PayPal invoice payload from validated invoice fields", async () => {
  const { buildPaypalInvoicePayload } = await import("./paypalInvoiceService.js");
  const payload = buildPaypalInvoicePayload({
    client: "Jordan Lee",
    email: "jordan@example.com",
    amount: "200.00",
    currency: "USD",
    description: "Consulting services",
    date: new Date("2026-11-09T00:00:00.000Z"),
    due: new Date("2026-11-24T00:00:00.000Z"),
  });

  assert.equal(payload.detail.invoice_date, "2026-11-09");
  assert.equal(payload.detail.currency_code, "USD");
  assert.equal(payload.detail.payment_term.term_type, "DUE_ON_DATE_SPECIFIED");
  assert.equal(payload.detail.payment_term.due_date, "2026-11-24");
  assert.equal(payload.primary_recipients[0]?.billing_info.email_address, "jordan@example.com");
  assert.deepEqual(payload.primary_recipients[0]?.billing_info.name, { given_name: "Jordan", surname: "Lee" });
  assert.equal(payload.items[0]?.quantity, "1");
  assert.deepEqual(payload.items[0]?.unit_amount, { currency_code: "USD", value: "200.00" });

  for (const [currency, amount] of [["EUR", "900.00"], ["GBP", "750.00"], ["CAD", "2000.00"]] as const) {
    const multiCurrencyPayload = buildPaypalInvoicePayload({
      client: "Priya Client",
      email: "client@example.com",
      amount,
      currency,
      description: "Professional services",
      date: new Date("2026-11-09T00:00:00.000Z"),
      due: new Date("2026-11-24T00:00:00.000Z"),
    });
    assert.equal(multiCurrencyPayload.detail.currency_code, currency);
    assert.deepEqual(multiCurrencyPayload.items[0]?.unit_amount, { currency_code: currency, value: amount });
  }
  const inrPayload = buildPaypalInvoicePayload({
    client: "Priya Client",
    email: "client@example.com",
    project: "Website Development",
    services: ["Frontend Development", "Backend Development", "Deployment"],
    amount: "50000",
    currency: "INR",
    description: "Website Development",
    date: new Date("2026-11-09T00:00:00.000Z"),
    due: new Date("2026-11-24T00:00:00.000Z"),
  });
  assert.equal(inrPayload.detail.currency_code, "INR");
  assert.deepEqual(inrPayload.items[0], {
    name: "Website Development",
    description: "Website Development",
    quantity: "1",
    unit_amount: { currency_code: "INR", value: "50000.00" },
  });

  const itemizedPayload = buildPaypalInvoicePayload({
    client: "John David",
    email: "john@example.com",
    project: "E-commerce website",
    services: ["Frontend work", "Backend development"],
    lineItems: [
      { description: "Frontend work", amount: "400.00" },
      { description: "Backend development", amount: "350.00" },
      { description: "Payment gateway integration", amount: "250.00" },
      { description: "Hosting and deployment", amount: "200.00" },
    ],
    amount: "1200.00",
    currency: "EUR",
    description: "E-commerce website",
    date: new Date("2026-11-09T00:00:00.000Z"),
    due: new Date("2026-11-19T00:00:00.000Z"),
  });
  assert.deepEqual(itemizedPayload.items.map((item) => ({
    description: item.description,
    amount: item.unit_amount.value,
    currency: item.unit_amount.currency_code,
  })), [
    { description: "Frontend work", amount: "400.00", currency: "EUR" },
    { description: "Backend development", amount: "350.00", currency: "EUR" },
    { description: "Payment gateway integration", amount: "250.00", currency: "EUR" },
    { description: "Hosting and deployment", amount: "200.00", currency: "EUR" },
  ]);
  assert.throws(() => buildPaypalInvoicePayload({
    client: "John David",
    email: "john@example.com",
    lineItems: [{ description: "Development", amount: "1199" }],
    amount: "1200",
    currency: "EUR",
    description: "Development",
    date: new Date("2026-11-09T00:00:00.000Z"),
    due: new Date("2026-11-19T00:00:00.000Z"),
  }), (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "INVOICE_LINE_ITEM_TOTAL_MISMATCH");
});

test("turns an empty legacy line-item array into one priced project item", async () => {
  const { buildPaypalInvoicePayload } = await import("./paypalInvoiceService.js");
  const payload = buildPaypalInvoicePayload({
    client: "Anitha",
    email: "client-us415@business.example.com",
    project: "banking website",
    lineItems: [],
    amount: "500",
    currency: "USD",
    description: "banking website",
    date: new Date("2026-11-10T00:00:00.000Z"),
    due: new Date("2026-11-12T00:00:00.000Z"),
  });

  assert.deepEqual(payload.items, [{
    name: "Banking website development",
    description: "Banking website development",
    quantity: "1",
    unit_amount: { currency_code: "USD", value: "500.00" },
  }]);
  assert.equal(payload.items.reduce((total, item) => total + Number(item.unit_amount.value), 0), 500);
});

test("rejects an unitemized invoice without a usable project or service description", async () => {
  const { buildPaypalInvoicePayload } = await import("./paypalInvoiceService.js");
  assert.throws(() => buildPaypalInvoicePayload({
    client: "Jordan Lee",
    email: "jordan@example.com",
    lineItems: [],
    amount: "200.00",
    currency: "USD",
    description: " ",
    date: new Date("2026-11-09T00:00:00.000Z"),
    due: new Date("2026-11-24T00:00:00.000Z"),
  }), (error: unknown) => error instanceof Error
    && "code" in error
    && error.code === "INVOICE_LINE_ITEM_DESCRIPTION_REQUIRED");
});

test("retries a saved legacy draft with empty line items using a persisted priced PayPal item", async (context) => {
  const [{ User }, { Invoice }, { env }, { clearPaypalTokenCache }, { publishLocalInvoiceToPaypal }] = await Promise.all([
    import("../models/User.ts"),
    import("../models/Invoice.ts"),
    import("../config/env.js"),
    import("./paypalClient.js"),
    import("./paypalInvoiceService.js"),
  ]);
  const ownerId = "507f1f77bcf86cd799439012";
  const draftId = "507f1f77bcf86cd799439011";
  const previousOwnerId = env.PAYPAL_ACCOUNT_OWNER_USER_ID;
  env.PAYPAL_ACCOUNT_OWNER_USER_ID = ownerId;
  context.after(() => { env.PAYPAL_ACCOUNT_OWNER_USER_ID = previousOwnerId; });

  const draft = {
    _id: draftId,
    clientId: null,
    client: "Anitha",
    email: "client-us415@business.example.com",
    project: "banking website",
    services: [] as string[],
    lineItems: [] as Array<{ description: string; amount: string }>,
    amount: "500.00",
    currency: "USD",
    description: "banking website",
    invoiceDate: new Date("2026-11-10T00:00:00.000Z"),
    dueDate: new Date("2026-11-12T00:00:00.000Z"),
    status: "Draft",
    source: "payleak",
    paypalRequestId: "ab2e1533-8526-4d7a-8e54-37d4800ec987",
    set(key: string, value: unknown) { Object.assign(this, { [key]: value }); },
    async save() {},
  };
  let savedInvoice: Record<string, unknown> | undefined;
  let submittedItems: Array<Record<string, unknown>> = [];
  context.mock.method(User, "findById", (() => ({ select: async () => ({ _id: ownerId }) })) as Function);
  context.mock.method(Invoice, "findOne", (() => draft) as Function);
  context.mock.method(Invoice, "findOneAndUpdate", ((_filter: unknown, update: { $set: Record<string, unknown> }) => {
    savedInvoice = { ...update.$set, _id: draftId };
    return { lean: async () => savedInvoice };
  }) as Function);
  context.mock.method(Invoice.collection, "indexes", (async () => []) as Function);
  context.mock.method(Invoice.collection, "createIndex", (async () => "paypal-invoice-test-index") as Function);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "temporary-test-token",
        expires_in: 3600,
        scope: "https://uri.paypal.com/services/invoicing/invoices/write",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const requestBody = JSON.parse(String(init?.body)) as {
      items: Array<Record<string, unknown>>;
    };
    submittedItems = requestBody.items;
    assert.deepEqual(draft.lineItems, [{
      description: "Banking website development",
      amount: "500.00",
    }]);
    return new Response(JSON.stringify({
      id: "PAYPAL-INVOICE-ANITHA",
      status: "DRAFT",
      detail: {
        invoice_number: "INV-ANITHA-1",
        invoice_date: "2026-11-10",
        currency_code: "USD",
        payment_term: { due_date: "2026-11-12" },
      },
      primary_recipients: [{
        billing_info: {
          email_address: "client-us415@business.example.com",
          name: { full_name: "Anitha" },
        },
      }],
      items: requestBody.items,
      amount: { value: "500.00", currency_code: "USD" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    clearPaypalTokenCache();
    const invoice = await publishLocalInvoiceToPaypal(
      ownerId,
      draftId,
      "ab2e1533-8526-4d7a-8e54-37d4800ec987",
    );
    assert.equal(submittedItems.length, 1);
    assert.deepEqual((submittedItems[0]?.unit_amount), {
      currency_code: "USD",
      value: "500.00",
    });
    assert.deepEqual(invoice.lineItems, [{
      description: "Banking website development",
      amount: "500.00",
    }]);
    assert.deepEqual(savedInvoice?.lineItems, invoice.lineItems);
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
  }
});

test("validates PayPal invoice currencies and fractional precision before calling PayPal", async () => {
  const { invoiceBody } = await import("../validators/invoice.js");
  const base = {
    client: "Jordan Lee",
    email: "jordan@example.com",
    amount: "200.00",
    currency: "USD",
    description: "Consulting services",
    date: "2026-11-09",
    due: "2026-11-24",
  };

  assert.equal(invoiceBody.safeParse(base).success, true);
  assert.equal(invoiceBody.safeParse({ ...base, currency: "INR", amount: "50000" }).success, true);
  assert.equal(invoiceBody.safeParse({ ...base, currency: "EUR", amount: "200.00" }).success, true);
  assert.equal(invoiceBody.safeParse({ ...base, currency: "GBP", amount: "200.00" }).success, true);
  assert.equal(invoiceBody.safeParse({ ...base, currency: "CAD", amount: "200.00" }).success, true);
  assert.equal(invoiceBody.safeParse({ ...base, currency: "XYZ" }).success, false);
  assert.equal(invoiceBody.safeParse({ ...base, currency: "JPY", amount: "200.50" }).success, false);
  assert.equal(invoiceBody.safeParse({ ...base, currency: "JPY", amount: "200" }).success, true);
});

test("maps PayPal currency validation errors to a safe currency-specific response", async () => {
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const { clearPaypalTokenCache, paypalRequest } = await import("./paypalClient.js");
  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "test-token", expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      name: "INVALID_REQUEST",
      message: "Request is not well-formed.",
      debug_id: "SAFE-TEST-ID",
      details: [
        { issue: null, description: "Currency Code is not valid." },
        { issue: null, description: "Currency Code is not valid." },
      ],
    }), { status: 400, headers: { "Content-Type": "application/json" } });
  };
  console.error = () => undefined;

  try {
    clearPaypalTokenCache();
    await assert.rejects(
      paypalRequest("/v2/invoicing/invoices", { method: "POST" }),
      (error: unknown) => error instanceof Error
        && "code" in error && error.code === "PAYPAL_CURRENCY_UNSUPPORTED"
        && "statusCode" in error && error.statusCode === 422
        && error.message === "This currency is not available for your PayPal account. Choose another currency."
        && "details" in error && error.details === undefined,
    );
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("creates invoices through PayPal with a request ID for safe retries", async () => {
  const originalFetch = globalThis.fetch;
  const { clearPaypalTokenCache } = await import("./paypalClient.js");
  const { createPaypalInvoiceRecord } = await import("./paypalInvoiceService.js");
  let requestUrl = "";
  let requestId: string | null = null;
  let prefer: string | null = null;
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "temporary-test-token",
        expires_in: 3600,
        scope: "https://uri.paypal.com/services/invoicing/invoices/read",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    requestUrl = url;
    requestId = new Headers(init?.headers).get("PayPal-Request-Id");
    prefer = new Headers(init?.headers).get("Prefer");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: "PAYPAL-INVOICE-123",
      status: "DRAFT",
      detail: { invoice_number: "INV-2001", currency_code: "USD" },
      amount: { value: "200.00", currency_code: "USD" },
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  };

  try {
    clearPaypalTokenCache();
    const created = await createPaypalInvoiceRecord({
      client: "Jordan Lee",
      email: "jordan@example.com",
      amount: "200.00",
      currency: "USD",
      description: "Consulting services",
      date: new Date("2026-11-09T00:00:00.000Z"),
      due: new Date("2026-11-24T00:00:00.000Z"),
    }, "d2719b58-b148-460e-995f-c2357406c060");
    assert.equal(requestUrl, "https://api-m.sandbox.paypal.com/v2/invoicing/invoices");
    assert.equal(requestId, "d2719b58-b148-460e-995f-c2357406c060");
    assert.equal(prefer, "return=representation");
    assert.equal(created.id, "PAYPAL-INVOICE-123");
    assert.equal(created.status, "DRAFT");
    assert.equal((requestBody.detail as { currency_code: string }).currency_code, "USD");
    assert.deepEqual((requestBody.items as Array<{ unit_amount: { value: string; currency_code: string } }>)[0]?.unit_amount, {
      currency_code: "USD",
      value: "200.00",
    });
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
  }
});

test("updates a linked PayPal draft and confirms its currency and exact amount", async () => {
  const originalFetch = globalThis.fetch;
  const { clearPaypalTokenCache } = await import("./paypalClient.js");
  const { updatePaypalInvoiceRecord } = await import("./paypalInvoiceService.js");
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "temporary-test-token",
        expires_in: 3600,
        scope: "https://uri.paypal.com/services/invoicing/invoices/write",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    requests.push({
      method: init?.method ?? "GET",
      path: url.pathname,
      ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}),
    });
    if (init?.method === "PUT") return new Response(null, { status: 204 });
    return new Response(JSON.stringify({
      id: "PAYPAL-INVOICE-123",
      status: "DRAFT",
      detail: {
        invoice_number: "INV-2001",
        invoice_date: "2026-11-09",
        currency_code: "INR",
        payment_term: { due_date: "2026-11-24" },
      },
      primary_recipients: [{ billing_info: { email_address: "priya@example.com", name: { full_name: "Priya Sharma" } } }],
      items: [{ name: "Website Development", description: "Frontend Development", quantity: "1", unit_amount: { value: "50000", currency_code: "INR" } }],
      amount: { value: "50000", currency_code: "INR" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    clearPaypalTokenCache();
    const updated = await updatePaypalInvoiceRecord("PAYPAL-INVOICE-123", {
      client: "Priya Sharma",
      email: "priya@example.com",
      project: "Website Development",
      services: ["Frontend Development"],
      amount: "50000",
      currency: "INR",
      description: "Frontend Development",
      date: new Date("2026-11-09T00:00:00.000Z"),
      due: new Date("2026-11-24T00:00:00.000Z"),
    });

    assert.deepEqual(requests.map(({ method, path }) => [method, path]), [
      ["PUT", "/v2/invoicing/invoices/PAYPAL-INVOICE-123"],
      ["GET", "/v2/invoicing/invoices/PAYPAL-INVOICE-123"],
    ]);
    assert.equal((requests[0]?.body?.detail as { currency_code: string }).currency_code, "INR");
    assert.equal(updated.amount?.value, "50000");
    assert.equal(updated.status, "DRAFT");
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
  }
});

test("sends a PayPal invoice separately and confirms its status after a 204 response", async () => {
  const originalFetch = globalThis.fetch;
  const { clearPaypalTokenCache } = await import("./paypalClient.js");
  const { sendPaypalInvoiceRecord } = await import("./paypalInvoiceService.js");
  const requests: Array<{ path: string; method: string; requestId: string | null }> = [];

  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({
        access_token: "temporary-test-token",
        expires_in: 3600,
        scope: "https://uri.paypal.com/services/invoicing/invoices/write",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    requests.push({
      path: url.pathname,
      method: init?.method ?? "GET",
      requestId: new Headers(init?.headers).get("PayPal-Request-Id"),
    });
    if (url.pathname.endsWith("/send")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({
      id: "PAYPAL-INVOICE-123",
      status: "SENT",
      detail: {
        invoice_number: "INV-2001",
        invoice_date: "2026-11-09",
        currency_code: "USD",
        payment_term: { due_date: "2026-11-24" },
      },
      primary_recipients: [{ billing_info: { email_address: "jordan@example.com" } }],
      items: [{ description: "Consulting services" }],
      amount: { value: "200.00", currency_code: "USD" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    clearPaypalTokenCache();
    const result = await sendPaypalInvoiceRecord("PAYPAL-INVOICE-123", "ab2e1533-8526-4d7a-8e54-37d4800ec987");
    assert.equal(result.status, "SENT");
    assert.deepEqual(requests.map(({ path, method }) => ({ path, method })), [
      { path: "/v2/invoicing/invoices/PAYPAL-INVOICE-123/send", method: "POST" },
      { path: "/v2/invoicing/invoices/PAYPAL-INVOICE-123", method: "GET" },
    ]);
    assert.equal(requests[0]?.requestId, "ab2e1533-8526-4d7a-8e54-37d4800ec987");
  } finally {
    clearPaypalTokenCache();
    globalThis.fetch = originalFetch;
  }
});
