import assert from "node:assert/strict";
import test from "node:test";
import { Types } from "mongoose";
import { PayPalIntegration } from "../models/PayPalIntegration.ts";
import { sharedPaypalDataFilter, sharedPaypalInvoiceFilter } from "./paypalIntegrationService.js";

test("authenticated users resolve to the same shared PayPal data while retaining private invoice scope", async (context) => {
  const sharedScope = new Types.ObjectId("507f1f77bcf86cd799439001");
  context.mock.method(PayPalIntegration, "findOne", (() => Promise.resolve({
    _id: "paypal-sandbox",
    dataScopeId: sharedScope,
  })) as Function);

  const userA = "507f1f77bcf86cd799439011";
  const userB = "507f1f77bcf86cd799439022";
  const transactionsA = await sharedPaypalDataFilter(userA);
  const transactionsB = await sharedPaypalDataFilter(userB);
  assert.deepEqual(transactionsA, {
    $or: [{ userId: new Types.ObjectId(userA) }, { userId: sharedScope }],
  });
  assert.deepEqual(transactionsB, {
    $or: [{ userId: new Types.ObjectId(userB) }, { userId: sharedScope }],
  });

  const invoicesB = await sharedPaypalInvoiceFilter(userB);
  assert.deepEqual(invoicesB, {
    $or: [
      { userId: new Types.ObjectId(userB) },
      { userId: sharedScope, source: "paypal" },
    ],
  });
});
