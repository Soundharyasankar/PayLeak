import assert from "node:assert/strict";
import test from "node:test";
import { claimPaypalWelcome } from "./paypalWelcome.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("claims the shared PayPal welcome once per authenticated user", () => {
  const storage = createStorage();
  assert.equal(claimPaypalWelcome({ id: "user-1" }, true, storage), true);
  assert.equal(claimPaypalWelcome({ id: "user-1" }, true, storage), false);
  assert.equal(claimPaypalWelcome({ id: "user-2" }, true, storage), true);
});

test("does not claim the welcome without confirmed connectivity or a user ID", () => {
  const storage = createStorage();
  assert.equal(claimPaypalWelcome({ id: "user-1" }, false, storage), false);
  assert.equal(claimPaypalWelcome({}, true, storage), false);
});
