import { Types } from "mongoose";
import { Decimal } from "decimal.js";
import { Client } from "../models/Client.js";
import { Invoice } from "../models/Invoice.js";
import { Transaction } from "../models/Transaction.js";
import { AppError } from "../utils/errors.js";
import { formatCurrencyAmount } from "../utils/money.js";

export async function listClients(userId: string, search?: string) {
  const filter: Record<string, unknown> = { userId };
  if (search) filter.$or = [
    { name: { $regex: escapeRegex(search), $options: "i" } },
    { email: { $regex: escapeRegex(search), $options: "i" } },
    { company: { $regex: escapeRegex(search), $options: "i" } },
  ];
  return Client.find(filter).sort({ name: 1 }).lean();
}

export async function getClient(userId: string, id: string) {
  const client = await Client.findOne({ _id: id, userId }).lean();
  if (!client) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
  const transactions = await Transaction.find({ userId, clientId: client._id }).select("grossAmount grossCurrency transactionDate status").sort({ transactionDate: -1 }).lean();
  const totals = new Map<string, { amount: Decimal; count: number }>();
  for (const transaction of transactions) {
    const total = totals.get(transaction.grossCurrency) ?? { amount: new Decimal(0), count: 0 };
    total.amount = total.amount.plus(transaction.grossAmount);
    total.count += 1;
    totals.set(transaction.grossCurrency, total);
  }
  return { ...client, transactions, paymentTotals: [...totals].map(([currency, total]) => ({ currency, amount: formatCurrencyAmount(total.amount, currency), count: total.count })) };
}

export async function deleteClient(userId: string, id: string) {
  const client = await Client.findOneAndDelete({ _id: id, userId });
  if (!client) throw new AppError(404, "Client not found.", "CLIENT_NOT_FOUND");
  await Transaction.updateMany({ userId: new Types.ObjectId(userId), clientId: client._id }, { $set: { clientId: null } });
  await Invoice.updateMany({ userId: new Types.ObjectId(userId), clientId: client._id }, { $set: { clientId: null } });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
