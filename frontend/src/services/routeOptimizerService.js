import { api, endpoints, isApiEnabled } from "./api.js";
import { calculateRoute, rankRoutes } from "../utils/calculations.js";

export async function compareRoutes({ amount, rate, routes, priority }) {
  if (!isApiEnabled) return { data: calculateDemoRoutes(amount, rate, routes, priority), source: "demo" };

  try {
    const response = await api.post(endpoints.compareRoutes, { amount, fromRate: rate, routes, priority });
    return { data: response.data, source: "api" };
  } catch (error) {
    if (error.response) throw error;
    return { data: calculateDemoRoutes(amount, rate, routes, priority), source: "demo" };
  }
}

function calculateDemoRoutes(amount, rate, routes, priority) {
  const estimates = routes.map((route) => ({
    ...route,
    ...calculateRoute(amount, rate * route.spread, route.fixed, route.percent, rate),
  }));
  return rankRoutes(estimates, priority);
}
