import { Decimal } from "decimal.js";
import { z } from "zod";
import { paypalInvoiceCurrencies } from "../config/paypalCurrencies.js";
import { AppError } from "../utils/errors.js";
import { calculateInvoiceLineItemTotal, type InvoiceLineItem } from "../utils/invoiceLineItems.js";
import { understandInvoiceMessage, type ConversationMessage } from "./aiService.js";

const invoiceDraftSchema = z.object({
  client: z.string().max(160).optional(),
  email: z.string().max(254).optional(),
  amount: z.string().max(32).optional(),
  currency: z.string().max(3).optional(),
  project: z.string().max(160).optional(),
  services: z.array(z.string().max(200)).max(30).optional(),
  lineItems: z.array(z.object({
    description: z.string().min(1).max(200),
    amount: z.string().max(32),
  }).strict()).min(1).max(30).optional(),
  description: z.string().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();

export type InvoiceDraftContext = z.infer<typeof invoiceDraftSchema>;

function validDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type RequiredInvoiceField = "client" | "email" | "amount" | "currency" | "description" | "due";

const requiredQuestions: Record<RequiredInvoiceField, (draft: InvoiceDraftContext) => string> = {
  client: () => "Who is this invoice for?",
  email: (draft) => `What is ${draft.client ? `${draft.client}'s ` : "the client's "}email address?`,
  amount: () => "What total amount should I invoice?",
  currency: () => "Which currency should I use? Please provide an ISO code such as USD, INR, or EUR.",
  description: () => "What work or service should the invoice describe?",
  due: () => "When is payment due? You can give a date or a number of days from today.",
};

function addDays(date: string, days: number) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function cleanDescription(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/(?:[\s,;:.]|^)(?:and|the)$/i, "").trim())
    .filter((line) => line && !/^(?:and|the)$/i.test(line))
    .join("\n");
}

export function firstMissingInvoiceField(draft: InvoiceDraftContext): RequiredInvoiceField | null {
  if (!draft.client?.trim()) return "client";
  if (!draft.email?.trim()) return "email";
  if (!draft.amount?.trim() || !/^\d+(?:\.\d+)?$/.test(draft.amount) || !new Decimal(draft.amount).gt(0)) return "amount";
  if (!draft.currency?.trim()) return "currency";
  if (!Object.hasOwn(paypalInvoiceCurrencies, draft.currency)) return "currency";
  if (!draft.description?.trim()) return "description";
  if (!draft.date || !draft.due) return "due";
  return null;
}

export function invoiceAssistantReply(missingField: RequiredInvoiceField | null, draft: InvoiceDraftContext) {
  if (!missingField) return "All required details are available. I'm saving your PayLeak draft now; PayPal will be attempted separately.";
  if (missingField === "email") {
    return `I understood your ${draft.project ? "project" : "invoice"} details. I need one more detail before saving the PayLeak draft: ${requiredQuestions[missingField](draft)}`;
  }
  return `I have captured the invoice details so far. Before I save the PayLeak draft, ${requiredQuestions[missingField](draft)}`;
}

export async function understandInvoiceTurn(
  message: string,
  currentDraftInput: unknown,
  history: ConversationMessage[] = [],
) {
  const currentDraft = invoiceDraftSchema.parse(currentDraftInput);
  if ((currentDraft.date && !validDateOnly(currentDraft.date))
    || (currentDraft.due && !validDateOnly(currentDraft.due))) {
    throw new AppError(422, "The current invoice dates are invalid. Please correct them before continuing.", "INVOICE_DATE_INVALID");
  }
  const understanding = await understandInvoiceMessage(message, currentDraft, history);
  const intent = understanding.intent ?? (Object.keys(currentDraft).length ? "update_invoice" : "create_invoice");
  if (understanding.clarificationRequired || intent === "clarify") {
    return {
      draft: currentDraft,
      missingField: null,
      ready: false,
      intent: "clarify" as const,
      reply: understanding.clarificationQuestion
        ?? understanding.responseMessage
        ?? "I found conflicting invoice details. Which value should I use?",
    };
  }
  if (intent === "show_invoice" || intent === "retry_paypal") {
    return {
      draft: currentDraft,
      missingField: null,
      ready: false,
      intent,
      reply: understanding.responseMessage
        ?? (intent === "show_invoice" ? "Opening your current invoice preview." : "Retrying PayPal for your saved local draft."),
    };
  }
  const draft = applyInvoiceUpdates(currentDraft, understanding.updates);
  const missingField = firstMissingInvoiceField(draft);
  const reply = invoiceAssistantReply(missingField, draft);
  return { draft, missingField, ready: missingField === null, intent, reply };
}

export function applyInvoiceUpdates(
  currentDraft: InvoiceDraftContext,
  updates: Awaited<ReturnType<typeof understandInvoiceMessage>>["updates"],
  referenceDate = new Date().toISOString().slice(0, 10),
) {
  if (!validDateOnly(referenceDate)) throw new AppError(422, "Invoice date is invalid.", "INVOICE_DATE_INVALID");
  if (updates.dueDate && !validDateOnly(updates.dueDate)) {
    throw new AppError(422, "The due date could not be understood. Please specify a valid calendar date.", "INVOICE_DUE_DATE_INVALID");
  }
  const {
    dueInDays,
    dueDate,
    addService,
    removeService,
    updateService,
    lineItems,
    currencyAmountsConfirmed,
    ...fieldUpdates
  } = updates;
  const hasExistingInvoiceDetails = Boolean(
    currentDraft.client || currentDraft.email || currentDraft.amount || currentDraft.currency
      || currentDraft.project || currentDraft.description || currentDraft.services?.length
      || currentDraft.lineItems?.length,
  );
  const draft: InvoiceDraftContext = {
    ...currentDraft,
    date: hasExistingInvoiceDetails ? currentDraft.date ?? referenceDate : referenceDate,
    ...fieldUpdates,
  };

  if (dueInDays !== undefined) {
    draft.due = addDays(draft.date ?? referenceDate, dueInDays);
  } else if (dueDate) {
    draft.due = dueDate;
  }

  const currencyChanged = Boolean(updates.currency && currentDraft.currency && updates.currency !== currentDraft.currency);
  if (currencyChanged && currentDraft.amount
    && (!currencyAmountsConfirmed
      || (currentDraft.lineItems?.length ? !lineItems : updates.amount === undefined))) {
    throw new AppError(422, "Currency changes do not convert invoice amounts. Confirm every amount in the new currency before continuing.", "INVOICE_CURRENCY_REQUIRES_NEW_AMOUNTS");
  }

  if (lineItems) draft.lineItems = lineItems;
  if (updates.services) draft.services = updates.services;
  if (addService) {
    const requestedCurrency = addService.currency?.toUpperCase() ?? draft.currency;
    if (!draft.currency || requestedCurrency !== draft.currency) {
      throw new AppError(422, "A new service must use the invoice's existing currency. PayLeak will not mix or convert currencies.", "INVOICE_SERVICE_CURRENCY_MISMATCH");
    }
    const additionalAmount = new Decimal(addService.amount);
    if (!additionalAmount.isFinite() || additionalAmount.lte(0)) {
      throw new AppError(422, "The added service amount must be positive.", "INVOICE_SERVICE_AMOUNT_INVALID");
    }
    if (draft.lineItems?.length) {
      draft.lineItems = [...draft.lineItems, { description: addService.description, amount: addService.amount }];
    } else {
      const baseAmount = currentDraft.amount;
      if (!baseAmount || !/^\d+(?:\.\d+)?$/.test(baseAmount)) {
        throw new AppError(422, "Set a valid invoice amount before adding a priced service.", "INVOICE_BASE_AMOUNT_REQUIRED");
      }
      const fractionDigits = paypalInvoiceCurrencies[draft.currency]?.fractionDigits;
      if (fractionDigits !== undefined && additionalAmount.decimalPlaces() > fractionDigits) {
        throw new AppError(422, `The added service amount must use valid ${draft.currency} precision.`, "INVOICE_SERVICE_AMOUNT_INVALID");
      }
      draft.amount = new Decimal(baseAmount).plus(additionalAmount).toFixed(fractionDigits);
    }
    draft.services = [...new Set([...(draft.services ?? currentDraft.services ?? []), addService.description])];
  }

  if (removeService || updateService) {
    if (!draft.lineItems?.length) {
      throw new AppError(422, "This invoice has no priced line-item details to safely change. Please provide the full updated line-item list.", "INVOICE_LINE_ITEMS_REQUIRED");
    }
    if (removeService) {
      const remaining = draft.lineItems.filter((item) => item.description.toLocaleLowerCase() !== removeService.toLocaleLowerCase());
      if (remaining.length === draft.lineItems.length) {
        throw new AppError(422, `Could not find the line item "${removeService}" to remove.`, "INVOICE_LINE_ITEM_NOT_FOUND");
      }
      if (remaining.length === 0) {
        throw new AppError(422, "An invoice must contain at least one priced line item.", "INVOICE_LINE_ITEMS_REQUIRED");
      }
      draft.lineItems = remaining;
    }
    if (updateService) {
      let found = false;
      draft.lineItems = draft.lineItems.map((item) => {
        if (item.description.toLocaleLowerCase() !== updateService.description.toLocaleLowerCase()) return item;
        found = true;
        return { ...item, amount: updateService.amount };
      });
      if (!found) {
        throw new AppError(422, `Could not find the line item "${updateService.description}" to update.`, "INVOICE_LINE_ITEM_NOT_FOUND");
      }
    }
  }

  if (updates.currency) draft.currency = updates.currency.toUpperCase();
  if (draft.lineItems?.length) {
    const calculatedTotal = calculateInvoiceLineItemTotal(draft.lineItems as InvoiceLineItem[], draft.currency ?? "");
    if (updates.amount && !new Decimal(updates.amount).eq(calculatedTotal)) {
      throw new AppError(
        422,
        `The stated total is ${draft.currency} ${updates.amount}, but the priced items add up to ${draft.currency} ${calculatedTotal}. Which value should I correct?`,
        "INVOICE_LINE_ITEM_TOTAL_MISMATCH",
      );
    }
    draft.amount = calculatedTotal;
    draft.services = draft.lineItems.map((item) => item.description);
  } else if (updates.amount && currentDraft.lineItems?.length) {
    const existingTotal = calculateInvoiceLineItemTotal(currentDraft.lineItems as InvoiceLineItem[], currentDraft.currency ?? "");
    if (!new Decimal(updates.amount).eq(existingTotal)) {
      throw new AppError(
        422,
        `The stated total is ${currentDraft.currency} ${updates.amount}, but the priced items add up to ${currentDraft.currency} ${existingTotal}. Which value should I correct?`,
        "INVOICE_LINE_ITEMS_REQUIRED",
      );
    }
  }
  if (updates.email) draft.email = updates.email.toLowerCase();
  if (updates.description) draft.description = cleanDescription(updates.description);
  else if (!currentDraft.description?.trim() && (updates.project || updates.services)) {
    draft.description = cleanDescription(
      [...new Set([draft.project, ...(draft.services ?? [])].filter((value): value is string => Boolean(value?.trim())))]
        .join("\n"),
    );
  }
  if (draft.description) draft.description = cleanDescription(draft.description);

  return draft;
}
