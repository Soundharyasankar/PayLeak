import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function currencyPrecision(currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new Error(`Unsupported ISO 4217 currency: ${currency}`);
  }
}

export function decimalAmount(value: string | number | Decimal, currency: string) {
  const amount = new Decimal(value);
  if (!amount.isFinite()) throw new Error("Amount must be finite.");
  return amount.toDecimalPlaces(currencyPrecision(currency), Decimal.ROUND_HALF_UP);
}

export function serializeDecimal(value: Decimal) {
  return value.toFixed();
}

export function formatCurrencyAmount(value: Decimal, currency: string) {
  return value.toFixed(currencyPrecision(currency) ?? 2);
}

export function zeroFor(currency: string) {
  return new Decimal(0).toFixed(currencyPrecision(currency));
}
