import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

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
  const users = [
    {
      _id: "507f1f77bcf86cd799439011",
      email: "session-test@example.com",
      name: "Session Test",
      passwordHash: await bcrypt.hash(password, 4),
    },
    {
      _id: "507f1f77bcf86cd799439012",
      email: "second-session-test@example.com",
      name: "Second Session Test",
      passwordHash: await bcrypt.hash(password, 4),
    },
  ];
  const emptyQuery = () => ({
    select() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => [],
  });
  const cookiePair = (value: string) => value.slice(0, value.indexOf(";"));

  context.mock.method(User, "findOne", ((query: { email: string }) => ({
    select: async () => users.find((user) => user.email === query.email),
  })) as Function, {});
  context.mock.method(User, "findById", ((id: string) => ({
    select() { return this; },
    lean: async () => {
      const user = users.find((candidate) => candidate._id === String(id));
      return user ? { _id: user._id, name: user.name, email: user.email } : null;
    },
  })) as Function, {});
  context.mock.method(User, "exists", (async () => false) as Function, {});
  context.mock.method(User, "create", (async (input: { name: string; email: string; passwordHash: string }) => {
    const user = {
      _id: "507f1f77bcf86cd799439013",
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
    };
    users.push(user);
    return user;
  }) as Function, {});
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

  const cookies: Array<{ all: string; legacy: string; partitioned: string }> = [];
  for (const user of users) {
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

    const setCookies = login.headers.getSetCookie();
    const legacyCookie = setCookies.find((value) => value.startsWith("payleak_access="));
    const partitionedCookie = setCookies.find((value) => value.startsWith("__Host-payleak_access="));
    if (!legacyCookie || !partitionedCookie) throw new Error("Login did not set both session cookies.");
    assert.match(legacyCookie, /Expires=/i);
    assert.doesNotMatch(legacyCookie, /Partitioned/i);
    assert.match(partitionedCookie, /HttpOnly/i);
    assert.match(partitionedCookie, /SameSite=None/i);
    assert.match(partitionedCookie, /Secure/i);
    assert.match(partitionedCookie, /Path=\//i);
    assert.doesNotMatch(partitionedCookie, /Domain=/i);
    assert.match(partitionedCookie, /Partitioned/i);
    const partitioned = cookiePair(partitionedCookie);
    const legacy = partitioned.replace("__Host-payleak_access=", "payleak_access=");
    const cookie = partitioned;
    cookies.push({ all: cookie, legacy, partitioned });

    const currentUser = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(currentUser.status, 200);
    assert.deepEqual((await currentUser.json() as { data: unknown }).data, {
      id: user._id,
      name: user.name,
      email: user.email,
    });
  }

  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Registered Test", email: "registered-session@example.com", password }),
  });
  assert.equal(registration.status, 201);
  const registeredUser = await registration.json() as { data: { user: { id: string; name: string; email: string } } };
  assert.deepEqual(registeredUser.data.user, {
    id: "507f1f77bcf86cd799439013",
    name: "Registered Test",
    email: "registered-session@example.com",
  });
  const registrationCookies = registration.headers.getSetCookie();
  const registeredLegacyCookie = registrationCookies.find((value) => value.startsWith("payleak_access="));
  const registeredPartitionedCookie = registrationCookies.find((value) => value.startsWith("__Host-payleak_access="));
  if (!registeredLegacyCookie || !registeredPartitionedCookie) {
    throw new Error("Registration did not set both session cookies.");
  }
  assert.match(registeredLegacyCookie, /Expires=/i);
  assert.doesNotMatch(registeredLegacyCookie, /Partitioned/i);
  assert.match(registeredPartitionedCookie, /HttpOnly/i);
  assert.match(registeredPartitionedCookie, /SameSite=None/i);
  assert.match(registeredPartitionedCookie, /Secure/i);
  assert.match(registeredPartitionedCookie, /Path=\//i);
  assert.doesNotMatch(registeredPartitionedCookie, /Domain=/i);
  assert.match(registeredPartitionedCookie, /Partitioned/i);
  const registeredCookie = cookiePair(registeredPartitionedCookie);
  cookies.push({
    all: registeredCookie,
    legacy: registeredCookie.replace("__Host-payleak_access=", "payleak_access="),
    partitioned: registeredCookie,
  });
  const registeredSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: registeredCookie },
  });
  assert.equal(registeredSession.status, 200);
  assert.deepEqual((await registeredSession.json() as { data: unknown }).data, registeredUser.data.user);

  const [firstSessionCookie, secondSessionCookie, registeredSessionCookie] = cookies;
  if (!firstSessionCookie || !secondSessionCookie || !registeredSessionCookie) {
    throw new Error("Expected three independent session cookies.");
  }
  const firstUser = users[0];
  if (!firstUser) throw new Error("Expected the first test user.");
  const legacySession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: secondSessionCookie.legacy },
  });
  assert.deepEqual((await legacySession.json() as { data: unknown }).data, {
    id: "507f1f77bcf86cd799439012",
    name: "Second Session Test",
    email: "second-session-test@example.com",
  });
  const preferredSession = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: `${firstSessionCookie.partitioned}; ${secondSessionCookie.legacy}` },
  });
  assert.deepEqual((await preferredSession.json() as { data: unknown }).data, {
    id: firstUser._id,
    name: firstUser.name,
    email: firstUser.email,
  });

  const protectedRequests = [
    { path: "/api/analytics", query: "", label: "analytics" },
    { path: "/api/invoices", query: "", label: "invoices" },
    { path: "/api/notifications", query: "", label: "notifications" },
    { path: "/api/transactions", query: "?limit=100", label: "transactions" },
  ];
  const expiredToken = jwt.sign(
    { email: "expired-session@example.com" },
    process.env.JWT_SECRET!,
    { subject: "507f1f77bcf86cd799439011", expiresIn: -1 },
  );

  for (const request of protectedRequests) {
    const missingToken = await fetch(`${baseUrl}${request.path}${request.query}`);
    assert.equal(missingToken.status, 401, `${request.label} must reject missing authentication`);
    assert.equal((await missingToken.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");

    const invalidToken = await fetch(`${baseUrl}${request.path}${request.query}`, {
      headers: { Cookie: "payleak_access=invalid-token" },
    });
    assert.equal(invalidToken.status, 401, `${request.label} must reject invalid authentication`);
    assert.equal((await invalidToken.json() as { error: { code: string } }).error.code, "INVALID_TOKEN");

    const expiredSession = await fetch(`${baseUrl}${request.path}${request.query}`, {
      headers: { Cookie: `__Host-payleak_access=${expiredToken}` },
    });
    assert.equal(expiredSession.status, 401, `${request.label} must reject expired authentication`);
    assert.equal((await expiredSession.json() as { error: { code: string } }).error.code, "INVALID_TOKEN");

    for (const cookie of cookies) {
      const authenticated: Response = await fetch(`${baseUrl}${request.path}${request.query}`, {
        headers: { Cookie: cookie.all },
      });
      assert.equal(authenticated.status, 200, `${request.label} must accept an independent login session`);
      assert.equal((await authenticated.json() as { success: boolean }).success, true);
    }
  }

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: registeredSessionCookie.all },
  });
  assert.equal(logout.status, 204);
  const clearedCookies = logout.headers.getSetCookie();
  assert.equal(clearedCookies.length, 2);
  const clearedLegacyCookie = clearedCookies.find((value) => value.startsWith("payleak_access=;"));
  if (!clearedLegacyCookie) throw new Error("Logout did not clear the legacy session cookie.");
  const clearedPartitionedCookie = clearedCookies.find((value) => value.startsWith("__Host-payleak_access=;"));
  if (!clearedPartitionedCookie) throw new Error("Logout did not clear the partitioned session cookie.");
  for (const cookie of [clearedLegacyCookie, clearedPartitionedCookie]) {
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=None/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /Path=\//i);
    assert.doesNotMatch(cookie, /Domain=/i);
  }
  assert.match(clearedPartitionedCookie, /Partitioned/i);
  const afterLogout = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(afterLogout.status, 401);
  assert.equal((await afterLogout.json() as { error: { code: string } }).error.code, "AUTH_REQUIRED");
});
