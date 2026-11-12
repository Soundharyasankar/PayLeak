import { Decimal } from "decimal.js";
import { z } from "zod";
import { paypalInvoiceCurrencies } from "../config/paypalCurrencies.js";
import { AppError } from "../utils/errors.js";
import { calculateInvoiceLineItemTotal, type InvoiceLineItem } from "../utils/invoiceLineItems.js";
import { understandInvoiceWithGroq } from "./invoiceAiService.js";

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
type InvoiceConversationMessage = { role: "user" | "assistant"; text: string };
type InvoiceAssistantUpdates = {
  client?: string;
  email?: string;
  amount?: string;
  currency?: string;
  project?: string;
  services?: string[];
  lineItems?: InvoiceLineItem[];
  description?: string;
  dueInDays?: number;
  dueDate?: string;
  currencyAmountsConfirmed?: boolean;
  addService?: { description: string; amount: string; currency?: string };
  removeService?: string;
  updateService?: { description: string; amount: string };
};

function validDateOnly(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

type RequiredInvoiceField = "client" | "email" | "amount" | "currency" | "description" | "due";

const requiredQuestions: Record<RequiredInvoiceField, (draft: InvoiceDraftContext) => string> = {
  client: () => "Who is this invoice for?",
  email: (draft) => `What is ${draft.client ? `${draft.client}'s ` : "the client's "}email address?`,
  amount: () => "What is the invoice total? If you want separate priced items, please provide their quantities and unit prices.",
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

export function firstMissingInvoiceField(draft: InvoiceDraftContext, referenceDate = todayUtc()): RequiredInvoiceField | null {
  if (!draft.client?.trim()) return "client";
  if (!draft.email?.trim() || !z.string().email().safeParse(draft.email).success) return "email";
  if (!draft.currency?.trim()) return "currency";
  if (!Object.hasOwn(paypalInvoiceCurrencies, draft.currency)) return "currency";
  if (!draft.description?.trim()) return "description";
  if (!draft.lineItems?.length || !draft.amount?.trim() || !/^\d+(?:\.\d+)?$/.test(draft.amount) || !new Decimal(draft.amount).gt(0)) return "amount";
  if (!draft.date || !draft.due || !validDateOnly(draft.due) || draft.due < referenceDate || draft.due < draft.date) return "due";
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
  history: InvoiceConversationMessage[] = [],
) {
  const currentDraft = invoiceDraftSchema.parse(currentDraftInput);
  if ((currentDraft.date && !validDateOnly(currentDraft.date))
    || (currentDraft.due && !validDateOnly(currentDraft.due))) {
    throw new AppError(422, "The current invoice dates are invalid. Please correct them before continuing.", "INVOICE_DATE_INVALID");
  }
  const intent = Object.keys(currentDraft).length ? "update_invoice" : "create_invoice";
  if (/\b(?:show|view|preview|open)\b.*\binvoice\b/i.test(message)) {
    return {
      draft: currentDraft,
      missingField: null,
      ready: false,
      intent: "show_invoice" as const,
      reply: "Opening your current invoice preview.",
    };
  }
  if (/\b(?:retry|try)\b.*\bpaypal\b/i.test(message)) {
    return {
      draft: currentDraft,
      missingField: null,
      ready: false,
      intent: "retry_paypal" as const,
      reply: "Retrying PayPal for your saved local draft.",
    };
  }
  const understanding = await understandInvoiceWithGroq(message, currentDraft, history);
  const result = invoiceAiResultToDraft(currentDraft, understanding);
  const invalidCurrency = Boolean(
    understanding.invoice.currency
    && !Object.hasOwn(paypalInvoiceCurrencies, understanding.invoice.currency.toUpperCase()),
  );
  const invalidDueDate = Boolean(
    understanding.invoice.due_date
    && !validDateOnly(understanding.invoice.due_date),
  );
  const missingField = invalidCurrency
    ? "currency"
    : invalidDueDate
      ? "due"
      : firstMissingInvoiceField(result.draft)
        || (result.totalMismatch || result.requiresAmountClarification ? "amount" : null);
  const ready = missingField === null;
  const reply = ready
    ? understanding.assistant_message
    : result.totalMismatch && missingField === "amount"
      ? `The priced items total ${result.totalMismatch.currency} ${result.totalMismatch.calculated}, but you stated ${result.totalMismatch.currency} ${result.totalMismatch.stated}. Which amount should I use?`
      : result.requiresAmountClarification && understanding.follow_up_question
        ? understanding.follow_up_question
        : invoiceAssistantReply(missingField, result.draft);
  return { draft: result.draft, missingField, ready, intent, reply };
}

function itemDescription(name: string, details: string) {
  const trimmedName = name.trim();
  const trimmedDetails = details.trim();
  if (!trimmedDetails) return trimmedName;
  if (!trimmedName || trimmedDetails.toLocaleLowerCase().includes(trimmedName.toLocaleLowerCase())) {
    return trimmedDetails;
  }
  return `${trimmedName}: ${trimmedDetails}`;
}

function conciseInvoiceItemDescription(name: string, details: string) {
  const formatted = itemDescription(name, details);
  if (formatted.length <= 200) return formatted;

  const trimmedDetails = details.trim();
  if (trimmedDetails.length > 0 && trimmedDetails.length <= 200) return trimmedDetails;

  const trimmedName = name.trim();
  if (trimmedName.length > 0 && trimmedName.length <= 200) return trimmedName;

  throw new AppError(422, "Each invoice item needs a useful description of 200 characters or fewer.", "INVOICE_ITEM_INVALID");
}

function uniqueDescriptions(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function joinServiceDescriptions(values: string[]) {
  const items = uniqueDescriptions(values).map((value) => value.replace(/[.!?]+$/, ""));
  if (items.length < 2) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function consolidatedItemName(project: string | undefined) {
  const title = project?.trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()) || "Invoice";
  return /\bservices?$/i.test(title) ? title : `${title} Services`;
}

function consolidatedItemDescription(
  items: Array<{ name: string; description: string }>,
  currentDraft: InvoiceDraftContext,
  project: string | undefined,
) {
  const itemDescriptions = items.map((item) => item.name.trim() || item.description.trim());
  const existingServices = currentDraft.services ?? [];
  const existingDescription = currentDraft.description
    ?.split(/\r?\n/)
    .filter((line) => line.trim() && line.trim().toLocaleLowerCase() !== project?.toLocaleLowerCase());
  const details = joinServiceDescriptions(
    itemDescriptions.length
      ? itemDescriptions
      : existingServices.length
        ? existingServices
        : existingDescription ?? (project ? [project] : []),
  );
  return details && !/[.!?]$/.test(details) ? `${details}.` : details;
}

export function invoiceAiResultToDraft(
  currentDraft: InvoiceDraftContext,
  response: Awaited<ReturnType<typeof understandInvoiceWithGroq>>,
  referenceDate = todayUtc(),
) {
  const invoice = response.invoice;
  const currency = invoice.currency?.trim().toUpperCase() || currentDraft.currency;
  const hasSupportedCurrency = Boolean(currency && Object.hasOwn(paypalInvoiceCurrencies, currency));
  const statedTotal = invoice.total_amount === null
    ? undefined
    : new Decimal(invoice.total_amount.toString()).toFixed();
  const hasItemValues = invoice.items.some((item) => item.quantity !== null || item.unit_price !== null);
  const hasCompleteItems = invoice.items.length > 0
    && invoice.items.every((item) => item.quantity !== null && item.unit_price !== null);
  const requiresAmountClarification = response.status === "needs_info"
    && response.missing_fields.includes("total_amount")
    && (response.missing_fields.includes("item_price")
      || response.missing_fields.includes("item_quantity"));
  const currencyChanged = Boolean(invoice.currency && currentDraft.currency
    && invoice.currency.toUpperCase() !== currentDraft.currency.toUpperCase());
  const canKeepExistingItems = Boolean(currentDraft.lineItems?.length && !currencyChanged);
  const reusableDraftTotal = currentDraft.amount
    && /^\d+(?:\.\d+)?$/.test(currentDraft.amount)
    && new Decimal(currentDraft.amount).gt(0)
    ? currentDraft.amount
    : undefined;
  const consolidationTotal = statedTotal
    ?? (!currentDraft.lineItems?.length ? reusableDraftTotal : undefined);
  const project = invoice.project_name?.trim() || currentDraft.project;

  let lineItems: InvoiceLineItem[] | undefined;
  if (hasSupportedCurrency && hasCompleteItems && !requiresAmountClarification) {
    lineItems = invoice.items.map((item) => {
      if (item.quantity === null || item.unit_price === null
        || item.quantity <= 0 || item.unit_price <= 0) {
        throw new AppError(422, "Each invoice item must have a positive quantity and unit price.", "INVOICE_ITEM_INVALID");
      }
      const amount = new Decimal(item.quantity.toString())
        .times(new Decimal(item.unit_price.toString()));
      if (!amount.isFinite() || amount.lte(0)) {
        throw new AppError(422, "Each invoice item must have a valid positive amount.", "INVOICE_ITEM_INVALID");
      }
      const description = conciseInvoiceItemDescription(item.name, item.description);
      if (!description) {
        throw new AppError(422, "Each invoice item needs a description of 200 characters or fewer.", "INVOICE_ITEM_INVALID");
      }
      const lineAmount = amount.toFixed();
      if (!/^\d{1,15}(?:\.\d{1,8})?$/.test(lineAmount)) {
        throw new AppError(422, "An invoice item amount exceeds the supported range.", "INVOICE_ITEM_INVALID");
      }
      return { description, amount: lineAmount };
    })
  } else if (hasSupportedCurrency && canKeepExistingItems) {
    lineItems = currentDraft.lineItems;
  } else if (hasSupportedCurrency && !hasItemValues && consolidationTotal) {
    const amount = new Decimal(consolidationTotal);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new AppError(422, "The invoice total must be a positive amount.", "INVOICE_AMOUNT_INVALID");
    }
    const description = consolidatedItemDescription(invoice.items, currentDraft, project);
    const name = consolidatedItemName(project);
    if (description) {
      lineItems = [{
        description: conciseInvoiceItemDescription(name, description),
        amount: amount.toFixed(),
      }];
    }
  }

  const calculatedTotal = lineItems?.length && hasSupportedCurrency && currency
    ? calculateInvoiceLineItemTotal(lineItems, currency)
    : undefined;
  const totalMismatch = statedTotal && calculatedTotal && currency
    && !new Decimal(statedTotal).eq(calculatedTotal)
    ? { currency, stated: statedTotal, calculated: calculatedTotal }
    : undefined;
  const services = invoice.items.length > 0
    ? invoice.items.map((item) => conciseInvoiceItemDescription(item.name, item.description)).filter(Boolean)
    : currentDraft.services;
  const serviceDetails = invoice.items.map((item) =>
    conciseInvoiceItemDescription(item.name, item.description));
  const descriptionLines = [
    project,
    ...serviceDetails,
  ].filter(Boolean);
  const fullDescription = descriptionLines.join("\n");
  const description = invoice.items.length === 0
    ? currentDraft.description || project
    : fullDescription.length <= 2000
      ? fullDescription || currentDraft.description
      : project || currentDraft.description;
  const updates: InvoiceAssistantUpdates = {
    ...(invoice.client_name?.trim() ? { client: invoice.client_name.trim() } : {}),
    ...(invoice.client_email?.trim() ? { email: invoice.client_email.trim().toLowerCase() } : {}),
    ...(project ? { project } : {}),
    ...(hasSupportedCurrency && currency ? { currency } : {}),
    ...(invoice.due_date && validDateOnly(invoice.due_date) ? { dueDate: invoice.due_date } : {}),
    ...(services?.length ? { services } : {}),
    ...(description ? { description } : {}),
    ...(lineItems && calculatedTotal && !totalMismatch ? { lineItems, amount: calculatedTotal } : {}),
    ...(!lineItems && statedTotal && !totalMismatch ? { amount: statedTotal } : {}),
    ...(currency && currency !== currentDraft.currency && lineItems && calculatedTotal && !totalMismatch
      ? { currencyAmountsConfirmed: true }
      : {}),
  };
  if (totalMismatch && currentDraft.lineItems?.length && currencyChanged) {
    delete updates.currency;
  }
  return {
    draft: applyInvoiceUpdates(currentDraft, updates, referenceDate),
    totalMismatch,
    requiresAmountClarification,
  };
}

export function applyInvoiceUpdates(
  currentDraft: InvoiceDraftContext,
  updates: InvoiceAssistantUpdates,
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
    if (!updates.services) draft.services = draft.lineItems.map((item) => item.description);
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
