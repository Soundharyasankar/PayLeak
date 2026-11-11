import { Types } from "mongoose";
import { Client } from "../models/Client.js";
import { Invoice } from "../models/Invoice.ts";
import { Notification } from "../models/Notification.js";
import { AppError } from "../utils/errors.js";
import { ReminderDraft } from "../models/ReminderDraft.js";
import { sharedPaypalInvoiceFilter } from "./paypalIntegrationService.js";

export const MISSING_REMINDER_EMAIL_MESSAGE =
  "Client email address is missing. Please update the invoice or client details before creating the reminder.";

const INVOICE_NOT_FOUND_MESSAGE = "This invoice could not be found. Please refresh your invoice list.";
const reminderDraftIndexName = "invoiceId_1_active_reminder_draft_unique";
let reminderDraftIndexSetup: Promise<void> | undefined;

async function ensureReminderDraftIndex() {
  if (!reminderDraftIndexSetup) {
    reminderDraftIndexSetup = ReminderDraft.collection.createIndex(
      { invoiceId: 1, status: 1 },
      {
        unique: true,
        partialFilterExpression: { status: "draft" },
        name: reminderDraftIndexName,
      },
    ).then(() => undefined).catch((error: unknown) => {
      reminderDraftIndexSetup = undefined;
      throw error;
    });
  }
  await reminderDraftIndexSetup;
}

export function isValidReminderEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const email = value.trim();
  return email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !email.startsWith(".")
    && !email.includes("..");
}

export function isInvoiceOverdue(invoice: {
  status: string;
  dueDate?: Date | null;
}, now = new Date()) {
  if (!invoice.dueDate || !["Sent", "Partially Paid", "Overdue"].includes(invoice.status)) return false;
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);
  const dueUtc = new Date(invoice.dueDate);
  dueUtc.setUTCHours(0, 0, 0, 0);
  return dueUtc.getTime() < todayUtc.getTime();
}

type ReminderInvoice = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  clientId?: Types.ObjectId | null;
  client: string;
  email?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  invoiceNumber?: string | null;
  amount: string;
  totalAmount?: string | null;
  currency: string;
  dueDate?: Date | null;
  status: string;
};

export function resolveReminderRecipientFromRecords(
  invoice: Pick<ReminderInvoice, "clientId" | "email" | "customerEmail" | "client" | "customerName">,
  linkedClient?: { name?: string; email?: string | null } | null,
) {
  if (invoice.clientId && !linkedClient) {
    throw new AppError(422, MISSING_REMINDER_EMAIL_MESSAGE, "REMINDER_EMAIL_MISSING");
  }
  const linkedClientEmail = isValidReminderEmail(linkedClient?.email)
    ? linkedClient.email.trim().toLowerCase()
    : null;
  const invoiceEmail = isValidReminderEmail(invoice.email)
    ? invoice.email.trim().toLowerCase()
    : null;
  const importedCustomerEmail = isValidReminderEmail(invoice.customerEmail)
    ? invoice.customerEmail.trim().toLowerCase()
    : null;
  const recipient = linkedClientEmail ?? invoiceEmail ?? importedCustomerEmail;
  if (!recipient) throw new AppError(422, MISSING_REMINDER_EMAIL_MESSAGE, "REMINDER_EMAIL_MISSING");
  const clientName = [linkedClient?.name, invoice.customerName, invoice.client]
    .find((value): value is string =>
      typeof value === "string" && Boolean(value.trim()) && !isValidReminderEmail(value));
  return {
    to: recipient,
    clientName: clientName?.trim() ?? "",
  };
}

function reminderMessage(invoice: ReminderInvoice, clientName: string) {
  const invoiceNumber = invoice.invoiceNumber || String(invoice._id);
  const amount = invoice.totalAmount ?? invoice.amount;
  const dueDate = invoice.dueDate?.toISOString().slice(0, 10);
  return {
    subject: `Reminder: Invoice ${invoiceNumber}`,
    message: `Hello${clientName ? ` ${clientName}` : ""},\n\nThis is a reminder that invoice ${invoiceNumber} for ${amount} ${invoice.currency}${dueDate ? ` was due on ${dueDate}` : ""}. Please let me know if you have any questions.\n\nThank you.`,
  };
}

async function findAccessibleInvoice(userId: string, invoiceId: string) {
  if (!Types.ObjectId.isValid(invoiceId)) {
    throw new AppError(404, INVOICE_NOT_FOUND_MESSAGE, "INVOICE_NOT_FOUND");
  }
  const invoice = await Invoice.findOne({
    _id: new Types.ObjectId(invoiceId),
    ...await sharedPaypalInvoiceFilter(userId),
  }).lean();
  if (!invoice) throw new AppError(404, INVOICE_NOT_FOUND_MESSAGE, "INVOICE_NOT_FOUND");
  return invoice as ReminderInvoice;
}

async function resolveReminderRecipient(invoice: ReminderInvoice) {
  let linkedClient: { name?: string; email?: string | null } | null = null;
  if (invoice.clientId) {
    linkedClient = await Client.findOne({ _id: invoice.clientId, userId: invoice.userId })
      .select("name email")
      .lean();
  }
  return resolveReminderRecipientFromRecords(invoice, linkedClient);
}

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
  await ensureReminderDraftIndex();
  const invoice = await findAccessibleInvoice(userId, invoiceId);
  if (!isInvoiceOverdue(invoice)) {
    throw new AppError(409, "This invoice is no longer overdue. Refresh your invoice list before creating a reminder.", "INVOICE_NOT_OVERDUE");
  }
  const recipient = await resolveReminderRecipient(invoice);
  const content = reminderMessage(invoice, recipient.clientName);
  const draftFields = {
    invoiceOwnerId: invoice.userId,
    to: recipient.to,
    ...content,
  };
  const existing = await ReminderDraft.findOne({ invoiceId: invoice._id, status: "draft" }).lean();
  if (existing) {
    const refreshed = await ReminderDraft.findOneAndUpdate(
      { _id: existing._id, status: "draft" },
      { $set: draftFields },
      { new: true, runValidators: true },
    ).lean();
    if (!refreshed) throw new AppError(409, "The reminder draft changed. Please try again.", "REMINDER_DRAFT_CHANGED");
    return toReminderDraftResponse(refreshed, false);
  }

  let draft;
  try {
    draft = await ReminderDraft.findOneAndUpdate(
      { invoiceId: invoice._id, status: "draft" },
      {
        $set: draftFields,
        $setOnInsert: { invoiceId: invoice._id, createdByUserId: new Types.ObjectId(userId), status: "draft" },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    draft = await ReminderDraft.findOne({ invoiceId: invoice._id, status: "draft" }).lean();
    if (!draft) throw error;
    return toReminderDraftResponse(draft, false);
  }
  if (!draft) throw new AppError(500, "Could not save the reminder draft.", "REMINDER_DRAFT_SAVE_FAILED");
  return toReminderDraftResponse(draft, true);
}

function toReminderDraftResponse(draft: {
  _id: unknown;
  invoiceId: unknown;
  to: string;
  subject: string;
  message: string;
  status: string;
}, created: boolean) {
  return {
    id: String(draft._id),
    invoiceId: String(draft.invoiceId),
    to: draft.to,
    subject: draft.subject,
    message: draft.message,
    status: draft.status,
    created,
    sent: false,
  };
}

export async function sendReminder(userId: string, invoiceId: string) {
  const invoice = await findAccessibleInvoice(userId, invoiceId);
  const draft = await ReminderDraft.findOne({
    invoiceId: invoice._id,
    invoiceOwnerId: invoice.userId,
    status: "draft",
  }).select("_id").lean();
  if (!draft) throw new AppError(404, "Reminder draft not found. Create and review the draft before sending.", "REMINDER_DRAFT_NOT_FOUND");
  throw new AppError(503, "Unable to send the reminder right now. The draft is saved; no email was sent.", "REMINDER_DELIVERY_UNAVAILABLE");
}
