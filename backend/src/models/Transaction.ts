import { model, Schema, type InferSchemaType } from "mongoose";

const conversionSchema = new Schema({
  sourceAmount: { type: String, default: null },
  sourceCurrency: { type: String, default: null },
  targetAmount: { type: String, default: null },
  targetCurrency: { type: String, default: null },
  exchangeRate: { type: String, default: null },
  rateDirection: { type: String, default: null },
  source: { type: String, enum: ["actual_paypal", "paypal_quote", "calculated_from_paypal_data", "unavailable"], default: "unavailable" },
  reference: { type: String, default: null },
  convertedAt: { type: Date, default: null },
}, { _id: false });

const transactionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  clientId: { type: Schema.Types.ObjectId, ref: "Client", default: null },
  paypalTransactionId: { type: String, required: true },
  transactionType: { type: String, required: true },
  status: { type: String, required: true },
  grossAmount: { type: String, required: true },
  grossCurrency: { type: String, required: true },
  feeAmount: { type: String, default: null },
  feeCurrency: { type: String, default: null },
  feeSource: { type: String, enum: ["actual_paypal", "official_fee_reference", "unavailable"], default: "unavailable" },
  paypalReportedNetAmount: { type: String, default: null },
  paypalReportedNetCurrency: { type: String, default: null },
  payleakCalculatedNetAmount: { type: String, default: null },
  payleakCalculatedNetCurrency: { type: String, default: null },
  netVerificationStatus: { type: String, enum: ["MATCH", "MISMATCH", "NOT_AVAILABLE", "NOT_APPLICABLE", "PENDING"], default: "PENDING" },
  netVerificationDifference: { type: String, default: null },
  netVerificationExplanation: { type: String, default: null },
  netVerificationReasons: { type: [String], default: [] },
  conversion: { type: conversionSchema, default: () => ({}) },
  withdrawalAmount: { type: String, default: null },
  withdrawalCurrency: { type: String, default: null },
  withdrawalFeeAmount: { type: String, default: null },
  withdrawalFeeCurrency: { type: String, default: null },
  finalAmount: { type: String, default: null },
  finalCurrency: { type: String, default: null },
  transactionDate: { type: Date, required: true },
  financialDataStatus: { type: String, enum: ["complete", "incomplete"], default: "incomplete" },
  aiAnalysis: {
    factsHash: { type: String, default: null },
    explanation: { type: String, default: null },
    insights: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
    generatedAt: { type: Date, default: null },
  },
  rawPaypal: { type: Schema.Types.Mixed, required: true },
  retrievedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

transactionSchema.index({ userId: 1, paypalTransactionId: 1 }, { unique: true });
transactionSchema.index({ userId: 1, transactionDate: -1 });

export type TransactionRecord = InferSchemaType<typeof transactionSchema>;
export const Transaction = model("Transaction", transactionSchema);
