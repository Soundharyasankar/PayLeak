import { api, endpoints, responseData } from "./api.js";

export async function askAssistant(question, history = []) {
  return responseData(await api.post(endpoints.chat, { question, history }, { timeout: 40_000 }));
}

export async function askFinancialAgent(question, contextClientId, selectedClientId, history = []) {
  return responseData(await api.post("/ai/financial-agent", {
    question,
    ...(contextClientId ? { contextClientId } : {}),
    ...(selectedClientId ? { selectedClientId } : {}),
    history: history.slice(-12),
  }, { timeout: 60_000 }));
}

export async function fetchFinancialAgentClients() {
  return responseData(await api.get("/clients"));
}

export async function createClientFinancialReport(clientId, period) {
  return responseData(await api.post("/ai/reports/client", {
    clientId,
    ...(period?.start ? { periodStart: period.start } : {}),
    ...(period?.end ? { periodEnd: period.end } : {}),
  }, { timeout: 60_000 }));
}

export async function downloadFinancialReport(reportId, fileName) {
  const response = await api.get(`/ai/reports/${encodeURIComponent(reportId)}/download`, {
    responseType: "blob",
    timeout: 60_000,
  });
  const objectUrl = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export async function testAssistantConnection() {
  return responseData(await api.post(endpoints.aiDiagnostics, {}, { timeout: 40_000 }));
}
