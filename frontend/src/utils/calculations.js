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

export function calculateRoute(amount, rate, fixedFee, percentageFee, referenceRate = rate) {
  const afterFixed = Math.max(0, amount - fixedFee);
  const afterPercentage = afterFixed * (1 - percentageFee / 100);
  return {
    finalAmount: afterPercentage * rate,
    fees: Math.max(0, amount - afterPercentage * rate / referenceRate),
  };
}

export function rankRoutes(routes, priority) {
  const sorters = {
    Cheapest: (a, b) => b.finalAmount - a.finalAmount,
    Fastest: (a, b) => a.hours - b.hours,
    "Lowest Risk": (a, b) => a.riskScore - b.riskScore,
  };
  return [...routes].sort(sorters[priority] || sorters.Cheapest);
}
