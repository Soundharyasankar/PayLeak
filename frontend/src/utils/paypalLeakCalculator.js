export const PAYPAL_LEAK_CONFIG = Object.freeze({
  percentFee: 0.044,
  fixedFee: Object.freeze({
    USD: 0.3,
    EUR: 0.35,
    GBP: 0.2,
    AUD: 0.3,
    CAD: 0.3,
    SGD: 0.5,
    INR: 3,
  }),
  gstRate: 0.18,
  conversionSpread: Object.freeze({
    receivedPayment: 0.03,
    otherConversion: 0.04,
  }),
});

export function calculatePaypalLeak({
  gross,
  currency,
  midRate,
  includeGst = true,
  conversionMode = "receivedPayment",
}) {
  const amount = Number(gross);
  const baseRate = currency === "INR" ? 1 : Number(midRate);
  const fixedFee = PAYPAL_LEAK_CONFIG.fixedFee[currency];
  const spread = currency === "INR"
    ? 0
    : PAYPAL_LEAK_CONFIG.conversionSpread[conversionMode];

  if (!Number.isFinite(amount) || amount <= 0) throw new RangeError("Gross amount must be greater than zero.");
  if (!Number.isFinite(baseRate) || baseRate <= 0) throw new RangeError("Mid-market rate must be greater than zero.");
  if (fixedFee === undefined) throw new RangeError("Unsupported payment currency.");
  if (spread === undefined) throw new RangeError("Unsupported conversion mode.");

  const percentFee = amount * PAYPAL_LEAK_CONFIG.percentFee;
  const totalFee = percentFee + fixedFee;
  const gst = includeGst ? totalFee * PAYPAL_LEAK_CONFIG.gstRate : 0;
  const netForeign = amount - totalFee - gst;
  const paypalRate = baseRate * (1 - spread);
  const inrCredited = currency === "INR" ? netForeign : netForeign * paypalRate;
  const midMarketValue = amount * baseRate;
  const totalLossINR = midMarketValue - inrCredited;
  const totalLossPercent = midMarketValue > 0 ? (totalLossINR / midMarketValue) * 100 : 0;
  const breakdown = {
    transactionFees: totalFee * baseRate,
    gst: gst * baseRate,
    fxSpread: currency === "INR" ? 0 : netForeign * baseRate * spread,
  };
  const breakdownTotal = breakdown.transactionFees + breakdown.gst + breakdown.fxSpread;

  return {
    gross: amount,
    currency,
    midRate: baseRate,
    percentFee,
    fixedFee,
    totalFee,
    gst,
    netForeign,
    spread,
    paypalRate,
    inrCredited,
    midMarketValue,
    totalLossINR,
    totalLossPercent,
    breakdown,
    breakdownTotal,
    breakdownDifference: breakdownTotal - totalLossINR,
    effectiveRate: amount > 0 ? inrCredited / amount : 0,
  };
}
