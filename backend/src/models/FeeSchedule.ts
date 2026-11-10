import { model, Schema, type InferSchemaType } from "mongoose";

const feeScheduleSchema = new Schema({
  market: { type: String, required: true },
  category: { type: String, required: true },
  senderMarketConditions: { type: String, default: null },
  receivedCurrency: { type: String, required: true },
  percentageFee: { type: String, default: null },
  fixedFee: { type: String, default: null },
  fixedFeeCurrency: { type: String, default: null },
  conversionCategory: { type: String, default: null },
  publishedConversionSpread: { type: String, default: null },
  effectiveAt: { type: Date, required: true },
  expiresAt: { type: Date, default: null },
  sourceUrl: { type: String, required: true },
  version: { type: String, required: true },
  verifiedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

feeScheduleSchema.index({ market: 1, category: 1, receivedCurrency: 1, effectiveAt: -1 });

export type FeeScheduleRecord = InferSchemaType<typeof feeScheduleSchema>;
export const FeeSchedule = model("FeeSchedule", feeScheduleSchema);
