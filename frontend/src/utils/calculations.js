const inrPerCurrency = { USD: 83.2, EUR: 90.4, GBP: 105.2, INR: 1 };

export function calculateLeak(transaction, reportCurrency = "INR") {
  const convertedEligible = Math.max(0, transaction.gross - transaction.fee);
  const reportRate = inrPerCurrency[reportCurrency] || inrPerCurrency.INR;
  const expectedRate = transaction.referenceRate / reportRate;
  const actualRate = transaction.actualRate / reportRate;
  const expected = convertedEligible * expectedRate;
  const actual = convertedEligible * actualRate;
  const conversionLoss = Math.max(0, expected - actual);
  const totalLoss = (transaction.fee + transaction.otherFees) * actualRate + conversionLoss;
  return { convertedEligible, expected, actual, conversionLoss, totalLoss, expectedRate, actualRate };
}
