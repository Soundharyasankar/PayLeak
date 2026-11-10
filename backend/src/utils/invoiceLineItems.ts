import { Decimal } from "decimal.js";
import { paypalInvoiceCurrencies } from "../config/paypalCurrencies.js";
import { AppError } from "./errors.js";

export interface InvoiceLineItem {
  description: string;
  amount: string;
}

export function normalizeInvoiceLineItems(
  lineItems: InvoiceLineItem[] | undefined,
  project: string | undefined,
  description: string,
  amount: string,
  currency: string,
): InvoiceLineItem[] {
  if (lineItems?.length) return lineItems;

  const projectName = project?.trim() ?? "";
  const invoiceDescription = description.trim();
  let itemDescription = invoiceDescription && (
    !projectName
    || invoiceDescription.toLocaleLowerCase() !== projectName.toLocaleLowerCase()
  ) && invoiceDescription.length <= 200 && !invoiceDescription.includes("\n")
    ? invoiceDescription
    : projectName;

  if (!itemDescription) {
    itemDescription = invoiceDescription.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  }
  if (!itemDescription) {
    throw new AppError(422, "Add a project or service description before creating a priced invoice line item.", "INVOICE_LINE_ITEM_DESCRIPTION_REQUIRED");
  }
  if (itemDescription.length > 200) {
    throw new AppError(422, "The project or service description must be 200 characters or fewer to create a priced invoice line item.", "INVOICE_LINE_ITEM_DESCRIPTION_INVALID");
  }

  const isDevelopmentProject = /\b(?:website|web(?:\s+app(?:lication)?)?|software|platform)\b/i.test(projectName);
  if (isDevelopmentProject
    && itemDescription.toLocaleLowerCase() === projectName.toLocaleLowerCase()
    && !/\bdevelopment$/i.test(itemDescription)) {
    itemDescription = `${itemDescription} development`;
  }
  itemDescription = itemDescription[0]!.toLocaleUpperCase() + itemDescription.slice(1);

  const item = { description: itemDescription, amount };
  return [{ ...item, amount: calculateInvoiceLineItemTotal([item], currency) }];
}

export function calculateInvoiceLineItemTotal(lineItems: InvoiceLineItem[], currency: string) {
  const currencyDetails = paypalInvoiceCurrencies[currency as keyof typeof paypalInvoiceCurrencies];
  if (!currencyDetails) {
    throw new AppError(422, "This currency is not available for PayPal invoicing. No conversion was applied.", "PAYPAL_CURRENCY_UNSUPPORTED");
  }
  if (lineItems.length === 0) {
    throw new AppError(422, "An invoice must contain at least one priced line item.", "INVOICE_LINE_ITEMS_REQUIRED");
  }

  const total = lineItems.reduce((sum, item) => {
    let amount: Decimal;
    try {
      amount = new Decimal(item.amount);
    } catch {
      throw new AppError(422, "Each invoice line item must have a valid amount.", "INVOICE_LINE_ITEM_INVALID");
    }
    if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > currencyDetails.fractionDigits) {
      throw new AppError(422, `Each ${currency} line item must be positive and use valid currency precision.`, "INVOICE_LINE_ITEM_INVALID");
    }
    return sum.plus(amount);
  }, new Decimal(0));

  return total.toFixed(currencyDetails.fractionDigits);
}
