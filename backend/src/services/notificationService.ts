import { Types } from "mongoose";
import { Invoice } from "../models/Invoice.js";
import { Notification } from "../models/Notification.js";
import { AppError } from "../utils/errors.js";

export async function listNotifications(userId: string) {
  const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
  return notifications.map((item) => ({
    id: String(item._id),
    category: item.category,
    title: item.title,
    body: item.body,
    time: item.createdAt.toISOString(),
    unread: !item.readAt,
  }));
}

export async function createNotification(input: {
  userId: string; category: "Payment" | "Invoice" | "Financial alert" | "AI recommendation" | "Sync"; title: string; body: string; dedupeKey: string;
}) {
  return Notification.findOneAndUpdate(
    { userId: input.userId, dedupeKey: input.dedupeKey },
    { $setOnInsert: input },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function markNotificationRead(userId: string, id: string, read: boolean) {
  const item = await Notification.findOneAndUpdate(
    { _id: new Types.ObjectId(id), userId },
    { $set: { readAt: read ? new Date() : null } },
    { new: true },
  );
  if (!item) throw new AppError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
}

export async function deleteNotification(userId: string, id: string) {
  const result = await Notification.deleteOne({ _id: new Types.ObjectId(id), userId });
  if (!result.deletedCount) throw new AppError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
}

export async function draftReminder(userId: string, invoiceId: string) {
  const invoice = await Invoice.findOne({ _id: invoiceId, userId }).lean();
  if (!invoice) throw new AppError(404, "Invoice not found.", "INVOICE_NOT_FOUND");
  return {
    invoiceId: String(invoice._id),
    to: invoice.email,
    message: `Hello ${invoice.client},\n\nThis is a reminder that invoice ${invoice.invoiceNumber || String(invoice._id)} for ${invoice.amount} ${invoice.currency}${invoice.dueDate ? ` was due on ${invoice.dueDate.toISOString().slice(0, 10)}` : ""}. Please let me know if you have any questions.\n\nThank you.`,
    status: "draft_only",
    sent: false,
  };
}

export async function sendReminder() {
  throw new AppError(503, "Email delivery is not configured. No reminder was sent.", "REMINDER_DELIVERY_UNAVAILABLE");
}
