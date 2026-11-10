import { model, Schema, type InferSchemaType } from "mongoose";

const quoteSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  quoteId: { type: String, required: true },
  baseCurrency: { type: String, required: true },
  quoteCurrency: { type: String, required: true },
  baseAmount: { type: String, required: true },
  quoteAmount: { type: String, default: null },
  exchangeRate: { type: String, default: null },
  expiresAt: { type: Date, default: null },
  refreshedAt: { type: Date, default: null },
  updatedAtPaypal: { type: Date, default: null },
  source: { type: String, enum: ["paypal_quote"], default: "paypal_quote" },
}, { timestamps: true, versionKey: false });

quoteSchema.index({ userId: 1, quoteId: 1 }, { unique: true });

export type PayPalExchangeRateQuoteRecord = InferSchemaType<typeof quoteSchema>;
export const PayPalExchangeRateQuote = model("PayPalExchangeRateQuote", quoteSchema);
