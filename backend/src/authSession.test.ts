import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/payleak-auth-test";
process.env.JWT_SECRET = "auth-session-test-signing-secret-value";
process.env.FRONTEND_URL = "https://payleak-1.onrender.com";
process.env.NODE_ENV = "production";

test("login cookie authenticates protected dashboard API requests", async (context) => {
  const [{ default: express }, bcrypt, { User }, { Transaction }, { Invoice }, { Notification }, { authRoutes }, { analyticsRoutes }, { invoiceRoutes }, { notificationRoutes }, { transactionRoutes }, { errorMiddleware }] = await Promise.all([
    import("express"),
    import("bcryptjs"),
    import("./models/User.ts"),
    import("./models/Transaction.ts"),
    import("./models/Invoice.ts"),
    import("./models/Notification.ts"),
    import("./routes/authRoutes.ts"),
    import("./routes/analyticsRoutes.ts"),
    import("./routes/invoiceRoutes.ts"),
    import("./routes/notificationRoutes.ts"),
    import("./routes/transactionRoutes.ts"),
    import("./middleware/errorMiddleware.ts"),
  ]);
  const password = "test-login-password";
  const user = {
    _id: "507f1f77bcf86cd799439011",
    email: "session-test@example.com",
    name: "Session Test",
    passwordHash: await bcrypt.hash(password, 4),
  };
  const emptyQuery = () => ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [],
  });

  context.mock.method(User, "findOne", (() => ({
    select: async () => user,
  })) as Function, {});
  context.mock.method(Transaction, "find", (() => emptyQuery()) as Function, {});
  context.mock.method(Transaction, "aggregate", (async () => []) as Function, {});
  context.mock.method(Transaction, "countDocuments", (async () => 0) as Function, {});
  context.mock.method(Invoice, "find", (() => emptyQuery()) as Function, {});
  context.mock.method(Notification, "find", (() => emptyQuery()) as Function, {});

  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/analytics", analyticsRoutes);
  app.use("/api/invoices", invoiceRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/transactions", transactionRoutes);
  app.use(errorMiddleware);

  const server = app.listen(0, "127.0.0.1");
  context.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: user.email, password }),
  });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), {
    success: true,
    data: { user: { id: user._id, name: user.name, email: user.email } },
  });

  const setCookie = login.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /payleak_access=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=None/i);
  assert.match(setCookie, /Secure/i);
  const cookie = setCookie.split(";")[0];
  assert.ok(cookie);

  const protectedRequests = [
    { path: "/api/analytics", query: "", label: "analytics" },
    { path: "/api/invoices", query: "", label: "invoices" },
    { path: "/api/notifications", query: "", label: "notifications" },
    { path: "/api/transactions", query: "?limit=100", label: "transactions" },
  ];

  for (const request of protectedRequests) {
    const missingToken = await fetch(`${baseUrl}${request.path}${request.query}`);
    assert.equal(missingToken.status, 401, `${request.label} must reject missing authentication`);
    assert.equal((await missingToken.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

    const invalidToken = await fetch(`${baseUrl}${request.path}${request.query}`, {
      headers: { Cookie: "payleak_access=invalid-token" },
    });
    assert.equal(invalidToken.status, 401, `${request.label} must reject invalid authentication`);
    assert.equal((await invalidToken.json() as { error: { code: string } }).error.code, "INVALID_TOKEN");

    const authenticated: Response = await fetch(`${baseUrl}${request.path}${request.query}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(authenticated.status, 200, `${request.label} must accept the login session cookie`);
    assert.equal((await authenticated.json() as { success: boolean }).success, true);
  }
});
