import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  timeout: 10000,
  withCredentials: true,
});

export const endpoints = {
  login: "/auth/login",
  register: "/auth/register",
  currentUser: "/auth/me",
  logout: "/auth/logout",
  transactions: "/transactions",
  invoices: "/invoices",
  analytics: "/analytics",
  leakAnalysis: "/analytics/leaks",
  chat: "/ai/chat",
  aiDiagnostics: "/ai/diagnostics",
  notifications: "/notifications",
  paypalConfig: "/paypal/config",
  paypalAccount: "/paypal/account",
  paypalDiagnostics: "/paypal/diagnostics",
  paypalOrders: "/paypal/orders",
};

export function responseData(response) {
  if (!response.data?.success) {
    throw new Error(response.data?.error?.message || "The API returned an unsuccessful response.");
  }
  return response.data.data;
}
