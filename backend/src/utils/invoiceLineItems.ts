import { Decimal } from "decimal.js";
import { paypalInvoiceCurrencies } from "../config/paypalCurrencies.js";
import { AppError } from "./errors.js";

export interface InvoiceLineItem {
  description: string;
  amount: string;
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
