import { model, Schema, type InferSchemaType } from "mongoose";

const webhookEventSchema = new Schema({
  eventId: { type: String, required: true, unique: true },
  eventType: { type: String, required: true },
  resourceId: { type: String, default: null },
  verified: { type: Boolean, required: true },
  processingStatus: { type: String, enum: ["received", "processed", "unmatched", "failed"], default: "received" },
  receivedAt: { type: Date, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, versionKey: false });

export type WebhookEventRecord = InferSchemaType<typeof webhookEventSchema>;
export const WebhookEvent = model("WebhookEvent", webhookEventSchema);
