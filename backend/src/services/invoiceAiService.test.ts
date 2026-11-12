import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/payleak-invoice-ai-test";
process.env.JWT_SECRET ??= "invoice-ai-test-signing-secret-not-a-real-key";
process.env.GROQ_API_KEY = "invoice-ai-test-key-not-a-real-credential";

const { understandInvoiceWithGroq } = await import("./invoiceAiService.js");

const completeResponse = {
  status: "complete",
  follow_up_question: null,
  missing_fields: [],
  invoice: {
    client_name: "Priya Sharma",
    client_email: "priya@example.com",
    project_name: "Website Development",
    currency: "INR",
    due_date: "2026-11-20",
    total_amount: 50000,
    items: [{
      name: "Website development",
      description: "Responsive business website",
      quantity: 1,
      unit_price: 50000,
    }],
  },
  assistant_message: "The invoice details are ready for review.",
};

function mockedGroqFetch(
  respond: (requestBody: Record<string, unknown>, call: number, pathname: string) => Response,
) {
  let call = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const response = respond(body, call, new URL(String(input)).pathname);
    call += 1;
    return response;
  };
  return { fetcher, calls: () => call };
}

function completion(content: string, status = 200, headers: HeadersInit = {}, errorCode?: string) {
  const body = status >= 400
    ? { error: { message: "provider error", code: errorCode } }
    : {
      id: "test-completion",
      object: "chat.completion",
      created: 1,
      model: "openai/gpt-oss-120b",
      choices: [{
        index: 0,
        finish_reason: "stop",
        logprobs: null,
        message: { role: "assistant", content },
      }],
    };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

test("sends a compact conversation to Groq with strict JSON schema and no tools", async () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? "assistant" as const : "user" as const,
    text: `turn-${index}`,
  }));
  const mocked = mockedGroqFetch((requestBody, _call, pathname) => {
    assert.equal(pathname, "/openai/v1/chat/completions");
    assert.equal(requestBody.model, "openai/gpt-oss-120b");
    assert.equal(requestBody.max_completion_tokens, 1600);
    assert.equal(requestBody.tools, undefined);
    const format = requestBody.response_format as {
      type: string;
      json_schema: {
        strict: boolean;
        schema: {
          required: string[];
          additionalProperties: boolean;
          properties: { invoice: { required: string[]; properties: { items: { items: { properties: { quantity: { anyOf: unknown[] } } } } } } };
        };
      };
    };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    assert.deepEqual(format.json_schema.schema.required, [
      "status", "follow_up_question", "missing_fields", "invoice", "assistant_message",
    ]);
    assert.equal(format.json_schema.schema.additionalProperties, false);
    assert.ok(format.json_schema.schema.properties.invoice.required.includes("total_amount"));
    assert.equal(
      format.json_schema.schema.properties.invoice.properties.items.items.properties.quantity.anyOf.length,
      2,
    );
    const messages = requestBody.messages as Array<{ role: string; content: string }>;
    const context = JSON.parse(messages[1]!.content) as { today: string; recentConversation: Array<{ text: string }>; currentMessage: string };
    assert.match(context.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(context.currentMessage, "Create the website invoice.");
    assert.deepEqual(context.recentConversation.map(({ text }) => text), history.slice(-12).map(({ text }) => text));
    return completion(JSON.stringify(completeResponse));
  });

  const result = await understandInvoiceWithGroq(
    "Create the website invoice.",
    {},
    history,
    mocked.fetcher,
  );
  assert.equal(result.status, "complete");
  assert.equal(mocked.calls(), 1);
});

test("does not classify an unknown API URL as an unavailable model", async () => {
  const mocked = mockedGroqFetch(() => completion("", 404, {}, "unknown_url"));
  await assert.rejects(
    understandInvoiceWithGroq("Create an invoice.", {}, [], mocked.fetcher),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "INVOICE_AI_UPSTREAM_NOT_FOUND"
      && !/GROQ_INVOICE_MODEL/.test(error.message),
  );
  assert.equal(mocked.calls(), 1);
});

test("repairs malformed model JSON once and returns a validated result", async () => {
  const mocked = mockedGroqFetch((requestBody, call) => {
    if (call === 1) {
      const messages = requestBody.messages as Array<{ role: string; content: string }>;
      assert.match(messages.at(-1)?.content ?? "", /failed server-side validation/);
      return completion(JSON.stringify(completeResponse));
    }
    return completion("{not-json");
  });
  const result = await understandInvoiceWithGroq("Create an invoice.", {}, [], mocked.fetcher);
  assert.equal(result.status, "complete");
  assert.equal(mocked.calls(), 2);
});

test("retries 429 only after the supplied retry-after interval", async () => {
  const mocked = mockedGroqFetch((_requestBody, call) => call === 0
    ? completion("", 429, { "retry-after": "0" })
    : completion(JSON.stringify(completeResponse)));
  const result = await understandInvoiceWithGroq("Create an invoice.", {}, [], mocked.fetcher);
  assert.equal(result.status, "complete");
  assert.equal(mocked.calls(), 2);
});

test("does not retry authentication failures and reports the failure category", async () => {
  const mocked = mockedGroqFetch(() => completion("", 401));
  await assert.rejects(
    understandInvoiceWithGroq("Create an invoice.", {}, [], mocked.fetcher),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "INVOICE_AI_AUTHENTICATION_FAILED"
      && /GROQ_API_KEY/.test(error.message),
  );
  assert.equal(mocked.calls(), 1);
});

test("does not retry unsupported-model failures and identifies the model configuration", async () => {
  const mocked = mockedGroqFetch(() => completion("", 404, {}, "model_not_found"));
  await assert.rejects(
    understandInvoiceWithGroq("Create an invoice.", {}, [], mocked.fetcher),
    (error: unknown) => error instanceof Error
      && "code" in error
      && error.code === "INVOICE_AI_MODEL_UNAVAILABLE"
      && /GROQ_INVOICE_MODEL/.test(error.message),
  );
  assert.equal(mocked.calls(), 1);
});

