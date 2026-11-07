import { api, endpoints, isApiEnabled } from "./api.js";
import { demoInvoices } from "../data/demoData.js";

export async function fetchInvoices() {
  if (!isApiEnabled) return { data: demoInvoices, source: "demo" };
  try {
    const response = await api.get(endpoints.invoices);
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    return { data: demoInvoices, source: "demo" };
  }
}

export async function saveInvoice(invoice) {
  if (!isApiEnabled) return { data: { ...invoice, status: "Draft", demo: true }, source: "demo" };
  try {
    const response = await api.post(endpoints.invoices, invoice);
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    return { data: { ...invoice, status: "Draft", demo: true }, source: "demo" };
  }
}

export async function sendInvoice(id) {
  if (!isApiEnabled) return { data: { id, status: "Sent", demo: true }, source: "demo" };
  try {
    const response = await api.post(`${endpoints.invoices}/${encodeURIComponent(id)}/send`);
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    return { data: { id, status: "Sent", demo: true }, source: "demo" };
  }
}

export function extractInvoiceDetails(prompt) {
  const amountMatch = prompt.match(/(?:\$|\u20AC|\u00A3|\u20B9)\s?([\d,]+(?:\.\d{1,2})?)/);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : "";
  const currency = prompt.includes("\u20AC") ? "EUR" : prompt.includes("\u00A3") ? "GBP" : prompt.includes("\u20B9") ? "INR" : "USD";
  const clientMatch = prompt.match(/for\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
  const daysMatch = prompt.match(/due in\s+(\d+)\s+days?/i);
  const promptTail = amountMatch ? prompt.slice(amountMatch.index + amountMatch[0].length) : prompt;
  const descriptionMatch = promptTail.match(/for\s+(.+?)(?:,\s*due|,\s*email|$)/i);
  const description = descriptionMatch?.[1]?.trim() || "Professional services";
  const due = new Date();
  due.setDate(due.getDate() + Number(daysMatch?.[1] || 14));
  return {
    client: clientMatch?.[1] || "",
    email: prompt.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] || "",
    amount,
    currency,
    description,
    date: new Date().toISOString().slice(0, 10),
    due: due.toISOString().slice(0, 10),
  };
}
