import assert from "node:assert/strict";
import test from "node:test";
import { authErrorMessage, shouldClearAuthSession, verifySessionUser } from "./authSession.js";

test("confirms the server session belongs to the account that signed in", async () => {
  const signedInUser = { id: "user-a", email: "a@example.com" };
  const sessionUser = { id: "user-a", email: "a@example.com" };
  assert.equal(await verifySessionUser(signedInUser, async () => sessionUser), sessionUser);
});

test("rejects a missing or mismatched server session", async () => {
  await assert.rejects(
    verifySessionUser({ id: "user-a" }, async () => ({ id: "user-b" })),
    /does not match the account/,
  );
  await assert.rejects(
    verifySessionUser({ id: "user-a" }, async () => { throw { response: { status: 401 } }; }),
    /could not verify your session/,
  );
});

test("reports session establishment, invalid credential, and network failures distinctly", () => {
  assert.match(authErrorMessage({
    response: { status: 401, data: { error: { code: "AUTH_REQUIRED" } } },
  }, "fallback"), /could not establish a browser session/);
  assert.equal(authErrorMessage({
    response: { status: 401, data: { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } } },
  }, "fallback"), "Email or password is incorrect.");
  assert.match(authErrorMessage({ isAxiosError: true }, "fallback"), /could not be reached/);
  assert.match(authErrorMessage({
    response: { status: 403, data: { error: { code: "FORBIDDEN", message: "Not allowed." } } },
  }, "fallback"), /Not allowed/);
});

test("expires protected requests on 401 but preserves login and session-restore errors", () => {
  assert.equal(shouldClearAuthSession({ response: { status: 401 }, config: { method: "get", url: "/transactions" } }), true);
  assert.equal(shouldClearAuthSession({ response: { status: 401 }, config: { method: "post", url: "/auth/login" } }), false);
  assert.equal(shouldClearAuthSession({ response: { status: 401 }, config: { method: "post", url: "/auth/register" } }), false);
  assert.equal(shouldClearAuthSession({ response: { status: 401 }, config: { method: "get", url: "/auth/me" } }), false);
  assert.equal(shouldClearAuthSession({ response: { status: 403 }, config: { method: "get", url: "/transactions" } }), false);
});
