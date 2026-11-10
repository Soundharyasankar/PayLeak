import { z } from "zod";

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Use a three-letter uppercase currency code.");
export const decimalString = z.string().trim().regex(/^\d{1,15}(?:\.\d{1,8})?$/, "Use a non-negative decimal amount as a string.");
export const idParam = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid record ID.") });
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
