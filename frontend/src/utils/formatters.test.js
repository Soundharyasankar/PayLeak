import assert from "node:assert/strict";
import test from "node:test";
import { transactionStatusLabel, transactionTypeLabel } from "./formatters.js";

test("formats PayPal transaction status and known event codes for people", () => {
  assert.equal(transactionStatusLabel("S"), "Completed");
  assert.equal(transactionStatusLabel("COMPLETED"), "Completed");
  assert.equal(transactionStatusLabel("P"), "Pending");
  assert.equal(transactionStatusLabel("V"), "Reversed");
  assert.equal(transactionTypeLabel("T1900"), "General account correction");
  assert.equal(transactionTypeLabel("T0006"), "Express Checkout payment");
});
