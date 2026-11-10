import { Decimal } from "decimal.js";
import { Types } from "mongoose";
import { FeeSchedule } from "../models/FeeSchedule.ts";
import { CurrencyConversion } from "../models/CurrencyConversion.js";
import { PayPalExchangeRateQuote } from "../models/PayPalExchangeRateQuote.js";
import { AppError } from "../utils/errors.js";
import { currencyPrecision, formatCurrencyAmount } from "../utils/money.js";

export async function latestPayPalRate(userId: string, from: string, to: string) {
  const quote = await PayPalExchangeRateQuote.findOne({
    userId,
    baseCurrency: from,
    quoteCurrency: to,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).sort({ updatedAtPaypal: -1, createdAt: -1 }).lean();
  if (!quote) {
    throw new AppError(503, "No current PayPal quote is available for this currency pair. No other rate source is used.", "PAYPAL_RATE_UNAVAILABLE", { fromCurrency: from, toCurrency: to });
  }
  return { ...quote, source: "paypal_quote", status: "available" };
}

export async function requestPayPalQuote() {
  throw new AppError(503, "The PayPal Pricing v2 exchange-rate quote capability is not enabled for this application. Confirm account eligibility and PayPal authorisation before enabling it.", "PAYPAL_QUOTE_UNAVAILABLE");
}

export async function calculateFromQuote(userId: string, input: { quoteId: string; amount: string; from: string; to: string }) {
  const quote = await PayPalExchangeRateQuote.findOne({ userId, quoteId: input.quoteId }).lean();
  if (!quote) throw new AppError(404, "PayPal quote not found.", "QUOTE_NOT_FOUND");
  if (quote.expiresAt && quote.expiresAt <= new Date()) throw new AppError(409, "The PayPal quote has expired.", "QUOTE_EXPIRED");
  const baseToQuote = quote.baseCurrency === input.from && quote.quoteCurrency === input.to;
  const quoteToBase = quote.baseCurrency === input.to && quote.quoteCurrency === input.from;
  if (!baseToQuote && !quoteToBase) throw new AppError(422, "Quote currencies do not match the requested conversion direction.", "QUOTE_CURRENCY_MISMATCH");

  if (baseToQuote && new Decimal(quote.baseAmount).eq(input.amount) && quote.quoteAmount) {
    return {
      amount: quote.quoteAmount,
      currency: input.to,
      sourceAmount: input.amount,
      sourceCurrency: input.from,
      source: "paypal_quote",
      status: "quoted",
      quoteId: quote.quoteId,
      expiresAt: quote.expiresAt,
    };
  }
  if (!quote.exchangeRate) {
    throw new AppError(422, "The quote does not contain a matching quote amount or an exchange rate.", "QUOTE_AMOUNT_UNAVAILABLE");
  }
  const rate = new Decimal(quote.exchangeRate);
  if (!rate.isFinite() || rate.lte(0)) throw new AppError(502, "The stored PayPal quote has an invalid exchange rate.", "INVALID_QUOTE_RATE");
  const result = baseToQuote ? new Decimal(input.amount).times(rate) : new Decimal(input.amount).div(rate);
  return {
    amount: formatCurrencyAmount(result.toDecimalPlaces(currencyPrecision(input.to) ?? 2, Decimal.ROUND_HALF_UP), input.to),
    currency: input.to,
    sourceAmount: input.amount,
    sourceCurrency: input.from,
    exchangeRate: quote.exchangeRate,
    rateDirection: `${quote.baseCurrency}/${quote.quoteCurrency}`,
    source: "calculated_from_paypal_data",
    status: "calculated",
    quoteId: quote.quoteId,
    expiresAt: quote.expiresAt,
  };
}

export async function listFeeSchedules() {
  return FeeSchedule.find({ verifiedAt: { $ne: null }, effectiveAt: { $lte: new Date() }, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] })
    .sort({ market: 1, category: 1, receivedCurrency: 1 })
    .lean();
}

export async function getConversion(userId: string, id: string) {
  const conversion = await CurrencyConversion.findOne({ _id: new Types.ObjectId(id), userId }).lean();
  if (!conversion) throw new AppError(404, "Currency conversion not found.", "CONVERSION_NOT_FOUND");
  return conversion;
}

export async function listRates(userId: string) {
  const quotes = await PayPalExchangeRateQuote.find({
    userId,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).sort({ updatedAtPaypal: -1 }).limit(200).lean();
  return quotes.map((quote) => ({
    fromCurrency: quote.baseCurrency,
    toCurrency: quote.quoteCurrency,
    exchangeRate: quote.exchangeRate,
    baseAmount: quote.baseAmount,
    quoteAmount: quote.quoteAmount,
    quoteId: quote.quoteId,
    expiresAt: quote.expiresAt,
    source: "paypal_quote",
  }));
}
