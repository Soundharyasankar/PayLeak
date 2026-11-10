import { api, endpoints, responseData } from "./api.js";

export async function fetchPayPalConfig() {
  return responseData(await api.get(endpoints.paypalConfig));
}

export async function createSandboxOrder({ amount, currency, description, idempotencyKey }) {
  return responseData(await api.post(endpoints.paypalOrders, { amount, currency, description }, {
    headers: { "Idempotency-Key": idempotencyKey },
    timeout: 35000,
  }));
}

export async function captureSandboxOrder(orderId) {
  return responseData(await api.post(`${endpoints.paypalOrders}/${encodeURIComponent(orderId)}/capture`, null, { timeout: 35000 }));
}

export async function cancelSandboxOrder(orderId) {
  return responseData(await api.post(`${endpoints.paypalOrders}/${encodeURIComponent(orderId)}/cancel`, null, { timeout: 35000 }));
}
