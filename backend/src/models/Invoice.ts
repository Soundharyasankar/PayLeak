import { model, Schema, type InferSchemaType } from "mongoose";

const invoiceSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "Client", default: null },
  client: { type: String, trim: true, maxlength: 160, default: "" },
  email: { type: String, lowercase: true, trim: true, maxlength: 254, default: "" },
  project: { type: String, trim: true, maxlength: 160, default: "" },
  services: { type: [String], default: [] },
  lineItems: {
    type: [{
      _id: false,
      description: { type: String, trim: true, maxlength: 200, required: true },
      amount: { type: String, required: true },
    }],
    default: [],
  },
  amount: { type: String, required: true },
  currency: { type: String, required: true, uppercase: true },
  description: { type: String, trim: true, maxlength: 2000, default: "" },
  invoiceNumber: { type: String, trim: true, maxlength: 160, default: null },
  customerEmail: { type: String, lowercase: true, trim: true, maxlength: 254, default: null },
  customerName: { type: String, trim: true, maxlength: 160, default: null },
  subtotal: { type: String, default: null },
  tax: { type: String, default: null },
  totalAmount: { type: String, default: null },
  paymentAmount: { type: String, default: null },
  paymentDate: { type: Date, default: null },
  invoiceUrl: { type: String, default: null },
  invoiceDate: { type: Date, required: true },
  dueDate: { type: Date, default: null },
  status: { type: String, enum: ["Draft", "Sent", "Partially Paid", "Paid", "Overdue", "Cancelled", "Refunded"], default: "Draft" },
  source: { type: String, enum: ["payleak", "paypal"], default: "payleak", required: true },
  paypalInvoiceId: { type: String, trim: true },
  paypalRequestId: { type: String, trim: true },
  assistantSessionId: { type: String, trim: true },
  paypalSendRequestId: { type: String, trim: true },
  paypalStatus: { type: String, default: null },
  paypalLastSyncedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index(
  { userId: 1, assistantSessionId: 1 },
  {
    unique: true,
    partialFilterExpression: { assistantSessionId: { $type: "string" } },
    name: "userId_1_assistantSessionId_1_unique",
  },
);
invoiceSchema.index(
  { userId: 1, paypalInvoiceId: 1 },
  {
    unique: true,
    partialFilterExpression: { paypalInvoiceId: { $type: "string" } },
    name: "userId_1_paypalInvoiceId_1_paypal_unique",
  },
);

export type InvoiceRecord = InferSchemaType<typeof invoiceSchema>;
export const Invoice = model("Invoice", invoiceSchema);
