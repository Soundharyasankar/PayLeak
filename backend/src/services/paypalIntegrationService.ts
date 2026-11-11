import { Types } from "mongoose";
import { env } from "../config/env.js";
import { PayPalAccount } from "../models/PayPalAccount.js";
import { PayPalIntegration } from "../models/PayPalIntegration.ts";

function fallbackSharedIntegration(userId: string) {
  const userScope = new Types.ObjectId(userId);
  return {
    _id: new Types.ObjectId(),
    key: paypalIntegrationKey(),
    dataScopeId: userScope,
    environment: env.PAYPAL_MODE,
    accountEmail: null,
    accountEmailVerified: false,
    connectedAt: new Date(),
    lastSyncedAt: null,
    lastInvoiceSyncedAt: null,
    capabilities: {
      transactionSearch: false,
      invoicing: false,
      exchangeRateQuotes: false,
    },
  };
}

function isMongoAvailabilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("buffering timed out")
    || message.includes("MongoServerSelectionError")
    || message.includes("connection timed out");
}

export function paypalIntegrationKey(environment = env.PAYPAL_MODE) {
  return `paypal-${environment}`;
}

export async function getSharedPaypalIntegration(seedUserId: string) {
  const key = paypalIntegrationKey();
  try {
    const current = await PayPalIntegration.findOne({ key });
    if (current) return current;

    const legacyAccount = await PayPalAccount.findOne({ environment: env.PAYPAL_MODE })
      .sort({ createdAt: 1 })
      .select("userId connectedAt lastSyncedAt capabilities")
      .lean();
    const configuredScopeId = env.PAYPAL_SHARED_DATA_NAMESPACE_ID || env.PAYPAL_ACCOUNT_OWNER_USER_ID;
    const dataScopeId = configuredScopeId
      ? new Types.ObjectId(configuredScopeId)
      : legacyAccount?.userId ?? new Types.ObjectId(seedUserId);
    const connectedAt = legacyAccount?.connectedAt ?? new Date();
    const initialValues = {
      key,
      dataScopeId,
      environment: env.PAYPAL_MODE,
      connectedAt,
      ...(legacyAccount ? {
        lastSyncedAt: legacyAccount.lastSyncedAt ?? null,
        capabilities: legacyAccount.capabilities,
      } : {}),
    };
    let integration;
    try {
      integration = await PayPalIntegration.findOneAndUpdate(
        { key },
        { $setOnInsert: initialValues },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      integration = await PayPalIntegration.findOne({ key });
    }
    if (!integration) throw new Error("Could not initialize the shared PayPal integration.");
    return integration;
  } catch (error) {
    if (!isMongoAvailabilityError(error)) throw error;
    return fallbackSharedIntegration(seedUserId);
  }
}

export async function sharedPaypalDataFilter(userId: string) {
  const integration = await getSharedPaypalIntegration(userId);
  const userScope = new Types.ObjectId(userId);
  const sharedScope = integration.dataScopeId;
  if (sharedScope.equals(userScope)) return { userId: userScope };
  return { $or: [{ userId: userScope }, { userId: sharedScope }] };
}

export async function sharedPaypalInvoiceFilter(userId: string) {
  const integration = await getSharedPaypalIntegration(userId);
  const userScope = new Types.ObjectId(userId);
  const sharedScope = integration.dataScopeId;
  if (sharedScope.equals(userScope)) return { userId: userScope };
  return {
    $or: [
      { userId: userScope },
      { userId: sharedScope, source: "paypal" },
    ],
  };
}

export async function updateSharedPaypalIntegration(
  userId: string,
  update: Record<string, unknown>,
) {
  try {
    const integration = await getSharedPaypalIntegration(userId);
    await PayPalIntegration.updateOne({ _id: integration._id }, update, { runValidators: true });
  } catch (error) {
    if (!isMongoAvailabilityError(error)) throw error;
  }
}
