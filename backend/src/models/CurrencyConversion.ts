import { model, Schema, type InferSchemaType } from "mongoose";

const currencyConversionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  transactionId: { type: Schema.Types.ObjectId, ref: "Transaction", default: null },
  paypalReference: { type: String, default: null },
  sourceCurrency: { type: String, required: true },
  targetCurrency: { type: String, required: true },
  sourceAmount: { type: String, required: true },
  targetAmount: { type: String, default: null },
  exchangeRate: { type: String, default: null },
  rateDirection: { type: String, default: null },
  quoteId: { type: String, default: null },
  quoteExpiresAt: { type: Date, default: null },
  convertedAt: { type: Date, default: null },
  sourceStatus: { type: String, enum: ["actual_paypal", "paypal_quote", "unavailable"], required: true },
  retrievedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

currencyConversionSchema.index({ userId: 1, paypalReference: 1 }, { unique: true, sparse: true });

export type CurrencyConversionRecord = InferSchemaType<typeof currencyConversionSchema>;
export const CurrencyConversion = model("CurrencyConversion", currencyConversionSchema);
