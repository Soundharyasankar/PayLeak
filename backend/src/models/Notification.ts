import { model, Schema, type InferSchemaType } from "mongoose";

const notificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  category: { type: String, enum: ["Payment", "Invoice", "Financial alert", "AI recommendation", "Sync"], required: true },
  title: { type: String, required: true, maxlength: 180 },
  body: { type: String, required: true, maxlength: 1000 },
  dedupeKey: { type: String, required: true },
  readAt: { type: Date, default: null },
  scheduledAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ userId: 1, createdAt: -1 });

export type NotificationRecord = InferSchemaType<typeof notificationSchema>;
export const Notification = model("Notification", notificationSchema);
