import { Decimal } from "decimal.js";
import { z } from "zod";
import { currencyCode, decimalString } from "./common.js";
import { paypalInvoiceCurrencies } from "../config/paypalCurrencies.js";

const paypalCurrency = currencyCode.refine(
  (value) => Object.prototype.hasOwnProperty.call(paypalInvoiceCurrencies, value),
  "Enter a valid ISO 4217 currency code.",
);

export const invoiceLineItem = z.object({
  description: z.string().trim().min(1).max(200),
  amount: decimalString.refine((value) => new Decimal(value).greaterThan(0), "Line item amount must be greater than zero."),
}).strict();

export const invoiceFields = z.object({
  clientId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  client: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(254),
  amount: decimalString.refine((value) => new Decimal(value).greaterThan(0), "Invoice amount must be greater than zero."),
  lineItems: z.array(invoiceLineItem).min(1).max(30).optional(),
  currency: paypalCurrency,
  description: z.string().trim().min(1).max(2000),
  date: z.coerce.date(),
  due: z.coerce.date(),
}).strict();

export function validateInvoiceAmountPrecision(
  value: { amount?: string; currency?: string; lineItems?: Array<{ amount: string }> },
  context: z.RefinementCtx,
) {
  if (!value.currency) return;
  const fractionDigits = paypalInvoiceCurrencies[value.currency as keyof typeof paypalInvoiceCurrencies]?.fractionDigits;
  const amounts = [
    ...(value.amount ? [value.amount] : []),
    ...(value.lineItems ?? []).map((item) => item.amount),
  ];
  for (const [index, amount] of amounts.entries()) {
    const decimalPlaces = amount.split(".")[1]?.length ?? 0;
    if (fractionDigits === undefined || decimalPlaces <= fractionDigits) continue;
    context.addIssue({
      code: "custom",
      message: `${value.currency} amounts cannot have more than ${fractionDigits} decimal places.`,
      path: index === 0 && value.amount ? ["amount"] : ["lineItems", index - (value.amount ? 1 : 0), "amount"],
    });
  }
};

export const invoiceBody = invoiceFields
  .superRefine(validateInvoiceAmountPrecision)
  .refine((value) => value.due >= value.date, {
    message: "Due date must be on or after the invoice date.",
    path: ["due"],
  });
