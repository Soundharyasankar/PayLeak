import { api, endpoints, isApiEnabled } from "./api.js";
import { demoTransactions, getLeakTotals } from "../data/demoData.js";

export async function fetchAnalytics() {
  if (!isApiEnabled) {
    return {
      data: {
        transactionCount: demoTransactions.length,
        identifiedCostsUsdEquivalent: getLeakTotals(demoTransactions),
      },
      source: "demo",
    };
  }

  try {
    const response = await api.get(endpoints.analytics);
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    return {
      data: {
        transactionCount: demoTransactions.length,
        identifiedCostsUsdEquivalent: getLeakTotals(demoTransactions),
      },
      source: "demo",
    };
  }
}
