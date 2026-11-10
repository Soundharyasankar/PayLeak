import { z } from "zod";
import { pagination } from "./common.js";

export const transactionQuery = pagination.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  status: z.string().max(40).optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "`from` must be on or before `to`." });

export const syncBody = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).strict().refine((value) => value.startDate <= value.endDate, { message: "startDate must be on or before endDate." })
  .refine((value) => value.endDate.getTime() - value.startDate.getTime() <= 3 * 365 * 24 * 60 * 60 * 1000, { message: "A PayPal sync range cannot exceed three years." });
