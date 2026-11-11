import { model, Schema, type InferSchemaType } from "mongoose";

const paypalIntegrationSchema = new Schema({
  key: { type: String, required: true, unique: true },
  dataScopeId: { type: Schema.Types.ObjectId, required: true },
  environment: { type: String, enum: ["sandbox", "live"], required: true },
  accountEmail: { type: String, trim: true, lowercase: true, default: null },
  accountEmailVerified: { type: Boolean, default: false },
  connectedAt: { type: Date, required: true },
  lastSyncedAt: { type: Date, default: null },
  lastInvoiceSyncedAt: { type: Date, default: null },
  capabilities: {
    transactionSearch: { type: Boolean, default: false },
    invoicing: { type: Boolean, default: false },
    exchangeRateQuotes: { type: Boolean, default: false },
  },
}, { timestamps: true, versionKey: false });

export type PayPalIntegrationRecord = InferSchemaType<typeof paypalIntegrationSchema>;
export const PayPalIntegration = model("PayPalIntegration", paypalIntegrationSchema);
