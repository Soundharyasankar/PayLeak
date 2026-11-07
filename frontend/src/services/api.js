import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api",
  timeout: 10000,
});

export const isApiEnabled = import.meta.env.VITE_API_MODE === "api";

export const endpoints = {
  transactions: "/transactions",
  invoices: "/invoices",
  analytics: "/analytics",
  leakAnalysis: "/analytics/leaks",
  compareRoutes: "/routes/compare",
  chat: "/ai/chat",
  notifications: "/notifications",
  paypalConnect: "/paypal/connect",
};
