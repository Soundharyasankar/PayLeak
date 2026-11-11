import { model, Schema, type InferSchemaType } from "mongoose";

const reminderDraftSchema = new Schema({
  invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true },
  invoiceOwnerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  to: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
  subject: { type: String, required: true, trim: true, maxlength: 240 },
  message: { type: String, required: true, maxlength: 4000 },
  status: { type: String, enum: ["draft"], default: "draft", required: true },
}, { timestamps: true, versionKey: false });

reminderDraftSchema.index(
  { invoiceId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "draft" }, name: "invoiceId_1_active_reminder_draft_unique" },
);
reminderDraftSchema.index({ invoiceOwnerId: 1, createdAt: -1 });

export type ReminderDraftRecord = InferSchemaType<typeof reminderDraftSchema>;
export const ReminderDraft = model("ReminderDraft", reminderDraftSchema);
