import { model, Schema, type InferSchemaType } from "mongoose";

const financialReportSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "Client", default: null },
  reportType: { type: String, enum: ["client"], required: true },
  fileName: { type: String, required: true },
  contentType: { type: String, required: true, default: "application/pdf" },
  pdf: { type: Buffer, required: true, select: false },
  periodStart: { type: Date, default: null },
  periodEnd: { type: Date, default: null },
  generatedAt: { type: Date, required: true },
}, { timestamps: true, versionKey: false });

financialReportSchema.index({ userId: 1, generatedAt: -1 });

export type FinancialReportRecord = InferSchemaType<typeof financialReportSchema>;
export const FinancialReport = model("FinancialReport", financialReportSchema);
