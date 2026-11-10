import { model, Schema, type InferSchemaType } from "mongoose";

const paypalAccountSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  payerId: { type: String, default: null },
  email: { type: String, trim: true, lowercase: true },
  environment: { type: String, enum: ["sandbox", "live"], required: true },
  connectedAt: { type: Date, required: true },
  lastSyncedAt: { type: Date, default: null },
  capabilities: {
    transactionSearch: { type: Boolean, default: false },
    invoicing: { type: Boolean, default: false },
    exchangeRateQuotes: { type: Boolean, default: false },
  },
}, { timestamps: true, versionKey: false });

export type PayPalAccountRecord = InferSchemaType<typeof paypalAccountSchema>;
export const PayPalAccount = model("PayPalAccount", paypalAccountSchema);
