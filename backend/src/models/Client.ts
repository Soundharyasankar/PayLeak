import { model, Schema, type InferSchemaType } from "mongoose";

const clientSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  email: { type: String, trim: true, lowercase: true, maxlength: 254 },
  company: { type: String, trim: true, maxlength: 160 },
  notes: { type: String, maxlength: 2000 },
}, { timestamps: true, versionKey: false });

clientSchema.index({ userId: 1, email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });

export type ClientRecord = InferSchemaType<typeof clientSchema>;
export const Client = model("Client", clientSchema);
