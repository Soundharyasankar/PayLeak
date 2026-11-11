import assert from "node:assert/strict";
import test from "node:test";
import { calculatePaypalLeak } from "./paypalLeakCalculator.js";

function approximatelyEqual(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual} should be within 0.001 of ${expected}`);
}

test("models USD 1,000 at 90 INR with GST", () => {
  const result = calculatePaypalLeak({ gross: 1000, currency: "USD", midRate: 90, includeGst: true });

  approximatelyEqual(result.totalFee, 44.3);
  approximatelyEqual(result.gst, 7.974);
  approximatelyEqual(result.netForeign, 947.726);
  approximatelyEqual(result.paypalRate, 87.3);
  approximatelyEqual(result.inrCredited, 82736.4798);
  approximatelyEqual(result.totalLossINR, 7263.5202);
  assert.ok(Math.abs(result.breakdownDifference) < 0.000001);
});

test("models EUR 500 at 100 INR with GST", () => {
  const result = calculatePaypalLeak({ gross: 500, currency: "EUR", midRate: 100, includeGst: true });

  approximatelyEqual(result.totalFee, 22.35);
  approximatelyEqual(result.gst, 4.023);
  approximatelyEqual(result.netForeign, 473.627);
  approximatelyEqual(result.paypalRate, 97);
  approximatelyEqual(result.inrCredited, 45941.819);
  approximatelyEqual(result.totalLossINR, 4058.181);
});

test("models USD 1,000 without GST from the configured fee and spread formulas", () => {
  const result = calculatePaypalLeak({ gross: 1000, currency: "USD", midRate: 90, includeGst: false });

  assert.equal(result.gst, 0);
  approximatelyEqual(result.inrCredited, 83432.61);
  approximatelyEqual(result.totalLossINR, 6567.39);
});

test("does not apply an FX spread to INR payments", () => {
  const result = calculatePaypalLeak({ gross: 1000, currency: "INR", midRate: 90, includeGst: true });

  assert.equal(result.midRate, 1);
  assert.equal(result.spread, 0);
  assert.equal(result.paypalRate, 1);
  assert.equal(result.breakdown.fxSpread, 0);
  approximatelyEqual(result.totalLossINR, result.totalFee + result.gst);
  approximatelyEqual(result.breakdownDifference, 0);
});

test("uses a four percent spread only for other conversion mode", () => {
  const result = calculatePaypalLeak({
    gross: 1000,
    currency: "USD",
    midRate: 90,
    includeGst: true,
    conversionMode: "otherConversion",
  });

  assert.equal(result.spread, 0.04);
  approximatelyEqual(result.paypalRate, 86.4);
});
