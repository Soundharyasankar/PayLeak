import { z } from "zod";

function optionalDraftString(max: number, pattern?: RegExp) {
  const value = pattern
    ? z.string().max(max).regex(pattern, "Expected a valid YYYY-MM-DD date.")
    : z.string().max(max);
  return z.preprocess(
    (input) => input === "" || input === null ? undefined : input,
    value.optional(),
  );
}

export const invoiceAssistantDraftSchema = z.object({
  client: optionalDraftString(160),
  email: optionalDraftString(254),
  amount: optionalDraftString(32),
  currency: optionalDraftString(3),
  project: optionalDraftString(160),
  services: z.preprocess((value) => value === null ? undefined : value, z.array(z.string().max(200)).max(30).optional()),
  lineItems: z.preprocess(
    (value) => value === null ? undefined : value,
    z.array(z.object({
      description: z.string().trim().min(1).max(200),
      amount: z.string().regex(/^\d{1,15}(?:\.\d{1,8})?$/),
    }).strict()).min(1).max(30).optional(),
  ),
  description: optionalDraftString(2000),
  date: optionalDraftString(10, /^\d{4}-\d{2}-\d{2}$/),
  due: optionalDraftString(10, /^\d{4}-\d{2}-\d{2}$/),
}).strict();

export const invoiceAssistantRequestSchema = z.object({
  message: z.string({
    error: "Invoice assistant request is missing the message field.",
  }).trim().min(1, "Enter a message for the invoice assistant.").max(2000),
  draft: z.preprocess(
    (value) => value === null ? undefined : value,
    invoiceAssistantDraftSchema.default({}),
  ),
  history: z.preprocess(
    (value) => value === null ? undefined : value,
    z.array(z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().trim().min(1).max(2000),
    }).strict()).max(12).default([]),
  ),
}).strict();

export type InvoiceAssistantRequest = z.infer<typeof invoiceAssistantRequestSchema>;
