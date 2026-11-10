import { Router } from "express";
import { requireAuth, getUserId } from "../middleware/authMiddleware.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/response.js";
import { currencyCode, decimalString, idParam } from "../validators/common.js";
import { z } from "zod";
import { calculateFromQuote, getConversion, latestPayPalRate, listFeeSchedules, listRates, requestPayPalQuote } from "../services/currencyService.js";

const quoteBody = z.object({ fromCurrency: currencyCode, toCurrency: currencyCode, amount: decimalString }).strict();
const calculateBody = z.object({ quoteId: z.string().min(1).max(200), amount: decimalString, from: currencyCode, to: currencyCode }).strict();
export const currencyRoutes = Router();
currencyRoutes.use(requireAuth);

currencyRoutes.get("/paypal/rates", asyncHandler(async (req, res) => success(res, await listRates(getUserId(req)))));
currencyRoutes.get("/paypal/rates/:from/:to", asyncHandler(async (req, res) => {
  const from = currencyCode.parse(req.params.from);
  const to = currencyCode.parse(req.params.to);
  return success(res, await latestPayPalRate(getUserId(req), from, to));
}));
currencyRoutes.post("/paypal/quote", validateBody(quoteBody), asyncHandler(async (_req, res) => success(res, await requestPayPalQuote())));
currencyRoutes.post("/paypal/calculate", validateBody(calculateBody), asyncHandler(async (req, res) => success(res, await calculateFromQuote(getUserId(req), req.body))));
currencyRoutes.get("/paypal/fees", asyncHandler(async (_req, res) => success(res, await listFeeSchedules())));
currencyRoutes.get("/paypal/conversions/:id", asyncHandler(async (req, res) => {
  const { id } = idParam.parse(req.params);
  return success(res, await getConversion(getUserId(req), id));
}));
