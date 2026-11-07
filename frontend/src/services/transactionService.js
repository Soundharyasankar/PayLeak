import { api, endpoints, isApiEnabled } from "./api.js";
import { demoTransactions } from "../data/demoData.js";
import { calculateLeak } from "../utils/calculations.js";

export async function fetchTransactions() {
  if (!isApiEnabled) return { data: demoTransactions, source: "demo" };
  try {
    const response = await api.get(endpoints.transactions);
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    return { data: demoTransactions, source: "demo" };
  }
}

export async function runLeakAnalysis(transactionId, reportCurrency = "INR") {
  if (!isApiEnabled) {
    const transaction = demoTransactions.find((item) => item.id === transactionId);
    if (!transaction) throw new Error(`Unknown demo transaction: ${transactionId}`);
    return { data: calculateLeak(transaction, reportCurrency), source: "demo" };
  }

  try {
    const response = await api.get(`${endpoints.leakAnalysis}/${encodeURIComponent(transactionId)}`, {
      params: { currency: reportCurrency },
    });
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    const transaction = demoTransactions.find((item) => item.id === transactionId);
    if (!transaction) throw new Error(`Unknown demo transaction: ${transactionId}`);
    return { data: calculateLeak(transaction, reportCurrency), source: "demo" };
  }
}
