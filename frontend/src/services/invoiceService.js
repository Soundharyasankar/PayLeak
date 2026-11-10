import { api, endpoints, responseData } from "./api.js";
import { buildInvoiceAssistantRequest } from "../utils/invoiceAgent.js";

export async function fetchInvoices() {
  return responseData(await api.get(endpoints.invoices));
}

export async function fetchInvoiceCurrencies() {
  return responseData(await api.get(`${endpoints.invoices}/currencies`));
}

export async function understandInvoiceTurn(message, draft, history, signal) {
  return responseData(await api.post(
    `${endpoints.invoices}/assistant`,
    buildInvoiceAssistantRequest(message, draft, history),
    { timeout: 45000, signal },
  ));
}

export async function saveLocalInvoiceDraft(invoice, assistantSessionId) {
  return responseData(await api.post(`${endpoints.invoices}/local-draft`, { ...invoice, assistantSessionId }, { timeout: 15000 }));
}

export async function syncPaypalInvoices() {
  return responseData(await api.post(`${endpoints.invoices}/sync-paypal`, {}, { timeout: 120000 }));
}

export async function diagnosePaypalInvoices() {
  return responseData(await api.post(`${endpoints.invoices}/paypal/diagnostics`, {}, { timeout: 30000 }));
}

export async function saveInvoice(invoice, idempotencyKey) {
  return responseData(await api.post(endpoints.invoices, invoice, {
    headers: { "Idempotency-Key": idempotencyKey },
    timeout: 30000,
  }));
}

export async function sendInvoice(id) {
  return responseData(await api.post(`${endpoints.invoices}/${encodeURIComponent(id)}/send`, {}, { timeout: 30000 }));
}

export async function publishInvoiceToPaypal(id, idempotencyKey) {
  return responseData(await api.post(
    `${endpoints.invoices}/${encodeURIComponent(id)}/paypal`,
    {},
    { headers: { "Idempotency-Key": idempotencyKey }, timeout: 30000 },
  ));
}

export async function updateInvoice(id, fields) {
  return responseData(await api.put(`${endpoints.invoices}/${encodeURIComponent(id)}`, fields));
}

export async function deleteInvoice(id) {
  await api.delete(`${endpoints.invoices}/${encodeURIComponent(id)}`);
}

function validCurrencyCodes(currencies) {
  const supported = new Set(currencies.map(({ code }) => code));
  if (typeof Intl.supportedValuesOf === "function") {
    for (const code of Intl.supportedValuesOf("currency")) supported.add(code);
  } else {
    for (const code of ["USD", "EUR", "GBP", "INR", "CAD", "AUD"]) supported.add(code);
  }
  return supported;
}
