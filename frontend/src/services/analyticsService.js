import { api, endpoints, responseData } from "./api.js";

export async function fetchAnalytics() {
  return responseData(await api.get(endpoints.analytics));
}
