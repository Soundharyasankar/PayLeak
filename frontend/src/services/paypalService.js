import { api, endpoints, isApiEnabled } from "./api.js";

export async function connectPayPalSandbox() {
  if (!isApiEnabled) {
    return {
      mode: "demo",
      email: "alex.freelancer@paypal-demo.example",
      accountType: "PayPal Sandbox",
      status: "connected",
    };
  }

  try {
    const response = await api.post(endpoints.paypalConnect, { mode: "sandbox" });
    return response.data;
  } catch (error) {
    if (error.response) throw error;
    return {
      mode: "demo",
      email: "alex.freelancer@paypal-demo.example",
      accountType: "PayPal Sandbox",
      status: "connected",
    };
  }
}
