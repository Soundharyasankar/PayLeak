import { Decimal } from "decimal.js";
import { currencyPrecision, formatCurrencyAmount } from "../utils/money.js";

export function calculateNetFromActual(grossAmount: string, grossCurrency: string, feeAmount: string | null, feeCurrency: string | null) {
  if (feeAmount === null || feeCurrency !== grossCurrency) return null;
  const net = new Decimal(grossAmount).minus(new Decimal(feeAmount).abs());
  if (net.isNegative()) return null;
  return formatCurrencyAmount(net.toDecimalPlaces(currencyPrecision(grossCurrency) ?? 2, Decimal.ROUND_HALF_UP), grossCurrency);
}

export function convertUsingPayPalRate(amount: string, rate: string, direction: "base_to_quote" | "quote_to_base", outputCurrency: string) {
  const input = new Decimal(amount);
  const exchangeRate = new Decimal(rate);
  if (!input.isFinite() || input.isNegative() || !exchangeRate.isFinite() || exchangeRate.lte(0)) {
    throw new Error("Amount and PayPal exchange rate must be finite and non-negative/positive.");
  }
  const output = direction === "base_to_quote" ? input.times(exchangeRate) : input.div(exchangeRate);
  return formatCurrencyAmount(output.toDecimalPlaces(currencyPrecision(outputCurrency) ?? 2, Decimal.ROUND_HALF_UP), outputCurrency);
}

export function actualFee(value: string | null, currency: string | null) {
  if (value === null || currency === null) return { value: null, currency: null, source: "unavailable" as const };
  return { value, currency, source: "actual_paypal" as const };
}
