import { model, Schema, type InferSchemaType } from "mongoose";

const paypalOrderSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  idempotencyKey: { type: String, required: true },
  captureRequestId: { type: String, required: true },
  paypalOrderId: { type: String, default: null },
  captureId: { type: String, default: null },
  amount: { type: String, required: true },
  currency: { type: String, required: true },
  description: { type: String, required: true },
  status: { type: String, enum: ["CREATING", "CREATED", "COMPLETED", "CANCELLED", "FAILED"], required: true },
  approvalUrl: { type: String, default: null },
}, { timestamps: true, versionKey: false });

paypalOrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
paypalOrderSchema.index({ paypalOrderId: 1 }, { unique: true, partialFilterExpression: { paypalOrderId: { $type: "string" } } });

export type PayPalOrderRecord = InferSchemaType<typeof paypalOrderSchema>;
export const PayPalOrder = model("PayPalOrder", paypalOrderSchema);
