import { api, endpoints, responseData } from "./api.js";

export async function fetchTransactions() {
  const response = await api.get(endpoints.transactions, { params: { limit: 100 } });
  return responseData(response).items;
}

export async function fetchTransactionPage(params, signal) {
  return responseData(await api.get(endpoints.transactions, { params, signal }));
}

export async function fetchTransaction(id, signal) {
  return responseData(await api.get(`${endpoints.transactions}/${encodeURIComponent(id)}`, { signal }));
}

export async function syncTransactions(startDate, endDate) {
  return responseData(await api.post(`${endpoints.transactions}/sync`, { startDate, endDate }, { timeout: 120000 }));
}

export function getDefaultPaypalSyncRange() {
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 3 * 365 * 24 * 60 * 60 * 1000);
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
}

export async function diagnosePaypalAccess() {
  return responseData(await api.post(endpoints.paypalDiagnostics, {}, { timeout: 30000 }));
}

export async function runLeakAnalysis(transactionId) {
  const response = await api.get(`${endpoints.transactions}/${encodeURIComponent(transactionId)}/currency-breakdown`);
  return responseData(response);
}

export async function fetchTransactionAiAnalysis(transactionId, { regenerate = false, signal } = {}) {
  const response = await api.get(
    `/analytics/transactions/${encodeURIComponent(transactionId)}/ai-analysis`,
    { params: regenerate ? { regenerate: "true" } : undefined, signal, timeout: 45000 },
  );
  return responseData(response);
}

export async function refreshPaypalTransaction(transactionId, signal) {
  const response = await api.post(`/transactions/${encodeURIComponent(transactionId)}/refresh`, {}, { timeout: 120000, signal });
  return responseData(response);
}
