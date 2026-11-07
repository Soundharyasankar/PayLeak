import { api, endpoints } from "./api.js";
import { demoNotifications } from "../data/demoData.js";

export async function fetchNotifications() {
  try {
    const response = await api.get(endpoints.notifications);
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    return { data: demoNotifications, source: "demo" };
  }
}
