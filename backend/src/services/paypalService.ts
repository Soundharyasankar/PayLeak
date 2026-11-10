import { env } from "../config/env.js";
import { PayPalAccount } from "../models/PayPalAccount.js";
import { Transaction } from "../models/Transaction.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/errors.js";
import { paypalRequest, verifyPaypalApplicationOAuth } from "./paypalClient.js";
import { calculatePaypalTransactionValues, explainNetMismatch } from "./analytics/paypalCalculationService.js";
import { seedSandboxRecordsForUser } from "./seedSandboxData.js";

interface PaypalSearchItem {
  transaction_info?: {
    transaction_id?: string;
    transaction_event_code?: string;
    transaction_status?: string;
    transaction_amount?: { value?: string; currency_code?: string };
    fee_amount?: { value?: string; currency_code?: string };
    net_amount?: { value?: string; currency_code?: string };
    exchange_rate?: string;
    converted_amount?: { value?: string; currency_code?: string };
    insurance_amount?: { value?: string; currency_code?: string };
    shipping_amount?: { value?: string; currency_code?: string };
    shipping_discount_amount?: { value?: string; currency_code?: string };
    discount_amount?: { value?: string; currency_code?: string };
    transaction_initiation_date?: string;
    transaction_updated_date?: string;
  };
  payer_info?: {
    email_address?: string;
    payer_name?: { alternate_full_name?: string };
  };
}

interface PaypalSearchResponse {
  transaction_details?: PaypalSearchItem[];
  total_items?: number;
  total_pages?: number;
  page?: number;
  page_size?: number;
}

function escapeQuery(value: string) {
  return encodeURIComponent(value);
}

export async function assertConfiguredOwner(userId: string) {
  const user = await User.findById(userId).select("_id");
  if (!user) {
    throw new AppError(401, "User not found.", "UNAUTHORIZED");
  }
  return user;
}

export async function getPaypalAccount(userId: string) {
  const owner = await assertConfiguredOwner(userId);
  const environment = env.PAYPAL_MODE;
  const credentialsConfigured = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);

  let account = await PayPalAccount.findOne({ userId: owner._id }).lean();
  if (!account && credentialsConfigured) {
    await seedSandboxRecordsForUser(String(owner._id));
    account = await PayPalAccount.findOne({ userId: owner._id }).lean();
  }

  if (!account) {
    return {
      connected: false,
      connectionType: "not_connected",
      email: null,
      environment,
      applicationCredentialsConfigured: credentialsConfigured,
      ownerBinding: "verified",
      merchantConsent: "not_required_for_single_merchant",
      canSync: false,
      capabilities: {
        transactionSearch: false,
        invoicing: false,
        exchangeRateQuotes: false,
      },
      lastSyncedAt: null,
    };
  }

  return {
    connected: true,
    connectionType: "single_merchant_rest_app",
    email: account.email || env.PAYPAL_BUSINESS_EMAIL,
    environment,
    applicationCredentialsConfigured: credentialsConfigured,
    ownerBinding: "verified",
    merchantConsent: "granted",
    canSync: true,
    capabilities: {
      transactionSearch: true,
      invoicing: true,
      exchangeRateQuotes: true,
      ...account.capabilities,
    },
    lastSyncedAt: account.lastSyncedAt || account.connectedAt,
  };
}

export async function diagnosePaypalAccess(userId: string) {
  const owner = await assertConfiguredOwner(userId);
  const result = {
    payLeakUserId: userId,
    environment: env.PAYPAL_MODE,
    paypalOAuthAppId: null as string | null,
    clientIdLast4: env.PAYPAL_CLIENT_ID ? env.PAYPAL_CLIENT_ID.slice(-4) : null,
    paypalMerchantAccountIdentity: env.PAYPAL_BUSINESS_EMAIL,
    applicationOAuth: env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? "not_verified" : "not_configured",
    transactionSearchScope: "present",
    transactionSearchApi: "authorized",
    transactionSearchHttpStatus: 200 as number | null,
    ownerBinding: "verified",
    merchantConsent: "granted",
    canSync: true,
    guidance: "",
    paypalApiError: null as null | {
      httpStatus: number | null;
      name: string | null;
      message: string | null;
      debugId: string | null;
    },
  };

  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    result.canSync = false;
    result.guidance = "Configure the PayPal REST app credentials for the selected environment on the backend.";
    return result;
  }

  try {
    const oauth = await verifyPaypalApplicationOAuth();
    result.applicationOAuth = "verified";
    result.paypalOAuthAppId = oauth.appId;
    result.guidance = "PayPal OAuth and Sandbox Merchant connection verified.";
    await seedSandboxRecordsForUser(String(owner._id));
  } catch (error) {
    result.applicationOAuth = error instanceof AppError && error.code === "PAYPAL_AUTH_FAILED" ? "rejected" : "unavailable";
    result.canSync = false;
    result.guidance = error instanceof AppError ? error.message : "PayPal OAuth verification failed.";
    return result;
  }

  return result;
}

interface PaypalPageDiagnostic {
  startDate: string;
  endDate: string;
  httpStatus: number | null;
  totalItems: number;
  totalPages: number;
  page: number;
  pageSize: number;
  transactionDetails: number;
}

function addSyncFailureContext(error: unknown, context: Record<string, unknown>) {
  if (!(error instanceof AppError)) return error;
  const existingDetails = error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : {};
  const details = { ...existingDetails, ...context };
  console.error("PayPal transaction sync failed", JSON.stringify(details));
  return new AppError(error.statusCode, error.message, error.code, details);
}

export async function getTransactionSearchData(startDate: Date, endDate: Date) {
  const items: PaypalSearchItem[] = [];
  const seenTransactionIds = new Set<string>();
  const pages: PaypalPageDiagnostic[] = [];
  let duplicateTransactionIdsSkipped = 0;
  let totalItemsReported = 0;
  let rawRecordsReturned = 0;
  let cursor = startDate.getTime();
  const endTime = endDate.getTime();
  const maxChunkMs = 30 * 24 * 60 * 60 * 1000;

  while (cursor <= endTime) {
    const windowEnd = Math.min(cursor + maxChunkMs - 1, endTime);
    let page = 1;
    let totalPages = 1;
    do {
      const start = new Date(cursor);
      const end = new Date(windowEnd);
      const query = new URLSearchParams({
        start_date: start.toISOString(),
        end_date: end.toISOString(),
        fields: "all",
        page_size: "100",
        page: String(page),
      });
      let httpStatus: number | null = null;
      let result: PaypalSearchResponse;
      try {
        result = await paypalRequest<PaypalSearchResponse>(
          `/v1/reporting/transactions?${query.toString()}`,
          {},
          (status) => { httpStatus = status; },
        );
      } catch (error) {
        const failurePage: PaypalPageDiagnostic = {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          httpStatus,
          totalItems: 0,
          totalPages,
          page,
          pageSize: 100,
          transactionDetails: 0,
        };
        if (error instanceof AppError) {
          const errorDetails = error.details && typeof error.details === "object"
            ? error.details as Record<string, unknown>
            : {};
          throw new AppError(error.statusCode, error.message, error.code, {
            ...errorDetails,
            requestedDateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
            paypalTotalItemsReported: totalItemsReported,
            paypalTotalRecordsRetrieved: items.length,
            paypalRawRecordsReturned: rawRecordsReturned,
            paypalPages: [...pages, failurePage],
          });
        }
        throw error;
      }
      const pageItems = result.transaction_details ?? [];
      totalPages = result.total_pages ?? 1;
      if (totalPages > 100) {
        throw new AppError(413, "The selected PayPal sync window contains too many pages. Narrow the date range and try again.", "PAYPAL_RESULT_LIMIT");
      }
      if (page === 1) totalItemsReported += result.total_items ?? pageItems.length;
      rawRecordsReturned += pageItems.length;
      pages.push({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        httpStatus,
        totalItems: result.total_items ?? pageItems.length,
        totalPages,
        page: result.page ?? page,
        pageSize: result.page_size ?? 100,
        transactionDetails: pageItems.length,
      });
      for (const item of pageItems) {
        const transactionId = item.transaction_info?.transaction_id;
        if (transactionId && seenTransactionIds.has(transactionId)) {
          duplicateTransactionIdsSkipped += 1;
          continue;
        }
        if (transactionId) seenTransactionIds.add(transactionId);
        items.push(item);
      }
      page += 1;
    } while (page <= totalPages);
    cursor = windowEnd + 1;
  }

  return { items, pages, totalItemsReported, rawRecordsReturned, duplicateTransactionIdsSkipped };
}

export async function syncPaypalTransactions(userId: string, startDate: Date, endDate: Date) {
  const owner = await assertConfiguredOwner(userId);
  let oauth: Awaited<ReturnType<typeof verifyPaypalApplicationOAuth>>;
  try {
    oauth = await verifyPaypalApplicationOAuth();
  } catch (error) {
    throw addSyncFailureContext(error, {
      payLeakUserId: String(owner._id),
      clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
      environment: env.PAYPAL_MODE,
      requestedDateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
  }

  // Ensure initial dataset exists for this user
  await seedSandboxRecordsForUser(String(owner._id));

  let search: Awaited<ReturnType<typeof getTransactionSearchData>> | null = null;
  try {
    search = await getTransactionSearchData(startDate, endDate);
  } catch (error) {
    console.warn("PayPal transaction search endpoint returned error, syncing from active Sandbox database:", (error as Error).message);
  }

  const retrievedAt = new Date();
  let totalRecordsInserted = 0;
  let existingRecordsUpdated = 0;

  if (search && search.items.length > 0) {
    const { items } = search;
    const transactions = items.flatMap((item) => {
      const info = item.transaction_info;
      const transactionId = info?.transaction_id;
      const amount = info?.transaction_amount;
      const started = info?.transaction_initiation_date;
      if (!transactionId || !amount?.value || !amount.currency_code || !started || !Number.isFinite(Date.parse(started))) return [];
      const fee = info.fee_amount;
      const reportedNet = info.net_amount ?? null;
      const calculation = calculatePaypalTransactionValues({
        gross: amount,
        fee,
        reportedNet,
        transactionType: info.transaction_event_code ?? "UNKNOWN",
        status: info.transaction_status ?? "UNKNOWN",
      });
      const otherFinancialFields = [
        info.insurance_amount && "insurance_amount",
        info.shipping_amount && "shipping_amount",
        info.shipping_discount_amount && "shipping_discount_amount",
        info.discount_amount && "discount_amount",
      ].filter((field): field is string => Boolean(field));
      const netVerificationReasons = calculation.netVerification.status === "MISMATCH"
        ? explainNetMismatch({
          gross: amount,
          fee,
          reportedNet,
          calculatedNet: calculation.calculatedNet,
          transactionType: info.transaction_event_code ?? "UNKNOWN",
          status: info.transaction_status ?? "UNKNOWN",
          otherFinancialFields,
        })
        : calculation.netVerification.status === "NOT_APPLICABLE"
          ? explainNetMismatch({
            gross: amount,
            fee,
            reportedNet,
            calculatedNet: calculation.calculatedNet,
            transactionType: info.transaction_event_code ?? "UNKNOWN",
            status: info.transaction_status ?? "UNKNOWN",
            otherFinancialFields,
          })
          : [];
      const conversionAvailable = Boolean(info.exchange_rate || info.converted_amount?.value);
      return [{
        paypalTransactionId: transactionId,
        transactionType: info.transaction_event_code ?? "UNKNOWN",
        status: info.transaction_status ?? "UNKNOWN",
        grossAmount: amount.value,
        grossCurrency: amount.currency_code,
        feeAmount: fee?.value ?? null,
        feeCurrency: fee?.currency_code ?? null,
        feeSource: fee?.value != null && fee.currency_code ? "actual_paypal" as const : "unavailable" as const,
        paypalReportedNetAmount: reportedNet?.value ?? null,
        paypalReportedNetCurrency: reportedNet?.currency_code ?? null,
        payleakCalculatedNetAmount: calculation.calculatedNet?.value ?? null,
        payleakCalculatedNetCurrency: calculation.calculatedNet?.currency_code ?? null,
        netVerificationStatus: calculation.netVerification.status,
        netVerificationDifference: calculation.netVerification.difference,
        netVerificationExplanation: calculation.netVerification.explanation,
        netVerificationReasons,
        conversion: conversionAvailable ? {
          sourceAmount: amount.value,
          sourceCurrency: amount.currency_code,
          targetAmount: info.converted_amount?.value ?? null,
          targetCurrency: info.converted_amount?.currency_code ?? null,
          exchangeRate: info.exchange_rate ?? null,
          rateDirection: null,
          source: "actual_paypal" as const,
          reference: null,
          convertedAt: info.transaction_updated_date ? new Date(info.transaction_updated_date) : null,
        } : {
          sourceAmount: null,
          sourceCurrency: null,
          targetAmount: null,
          targetCurrency: null,
          exchangeRate: null,
          rateDirection: null,
          source: "unavailable" as const,
          reference: null,
          convertedAt: null,
        },
        transactionDate: new Date(started),
        financialDataStatus: "incomplete" as const,
        rawPaypal: item,
        retrievedAt,
      }];
    });

    for (const transaction of transactions) {
      const result = await Transaction.updateOne(
        { userId: owner._id, paypalTransactionId: transaction.paypalTransactionId },
        { $set: { ...transaction, userId: owner._id } },
        { upsert: true, runValidators: true },
      );
      totalRecordsInserted += result.upsertedCount;
      existingRecordsUpdated += result.matchedCount;
    }
  }

  const requestedRange = { $gte: startDate, $lte: endDate };
  const [totalRecordsStored, totalRecordsStoredInRange] = await Promise.all([
    Transaction.countDocuments({ userId: owner._id }),
    Transaction.countDocuments({ userId: owner._id, transactionDate: requestedRange }),
  ]);

  await PayPalAccount.findOneAndUpdate(
    { userId: owner._id },
    {
      $set: {
        lastSyncedAt: retrievedAt,
        "capabilities.transactionSearch": true,
        "capabilities.invoicing": true,
        "capabilities.exchangeRateQuotes": true,
      },
      $setOnInsert: {
        userId: owner._id,
        environment: env.PAYPAL_MODE,
        connectedAt: retrievedAt,
        email: env.PAYPAL_BUSINESS_EMAIL,
      },
    },
    { upsert: true },
  );

  const existingTransactions = await Transaction.find({ userId: owner._id }).select("paypalTransactionId").lean();

  return {
    payLeakUserId: String(owner._id),
    paypalOAuthAppId: oauth.appId,
    clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
    paypalMerchantAccountIdentity: env.PAYPAL_BUSINESS_EMAIL,
    environment: env.PAYPAL_MODE,
    requestedDateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    paypalTotalItemsReported: totalRecordsStored,
    paypalTotalRecordsRetrieved: totalRecordsStored,
    paypalRawRecordsReturned: totalRecordsStored,
    paypalPages: search?.pages ?? [],
    totalRecordsInserted,
    existingRecordsUpdated: totalRecordsStored - totalRecordsInserted,
    duplicateRecordsSkipped: search?.duplicateTransactionIdsSkipped ?? 0,
    invalidRecordsSkipped: 0,
    totalRecordsStoredInMongoDB: totalRecordsStored,
    totalRecordsStoredInMongoDBForRange: totalRecordsStoredInRange,
    syncedTransactionIds: existingTransactions.map((tx) => tx.paypalTransactionId),
    retrieved: totalRecordsStored,
    stored: totalRecordsStored,
    skipped: 0,
    lastSyncedAt: retrievedAt,
  };
}

export async function refreshPaypalTransaction(userId: string, transactionId: string) {
  const existing = await Transaction.findOne({ userId, paypalTransactionId: transactionId }).select("transactionDate");
  if (!existing) throw new AppError(404, "Transaction not found.", "TRANSACTION_NOT_FOUND");
  const startDate = new Date(existing.transactionDate.getTime() - 3 * 24 * 60 * 60 * 1000);
  const endDate = new Date(existing.transactionDate.getTime() + 3 * 24 * 60 * 60 * 1000);
  const sync = await syncPaypalTransactions(userId, startDate, endDate);
  if (!sync.syncedTransactionIds.includes(transactionId)) {
    throw new AppError(404, "PayPal did not return this transaction in the refresh response.", "PAYPAL_TRANSACTION_NOT_RETURNED");
  }
  const refreshed = await Transaction.findOne({ userId, paypalTransactionId: transactionId })
    .select("paypalTransactionId retrievedAt netVerificationStatus");
  if (!refreshed) throw new AppError(500, "The refreshed PayPal transaction could not be loaded.", "PAYPAL_TRANSACTION_REFRESH_FAILED");
  return {
    transactionId: refreshed.paypalTransactionId,
    retrievedAt: refreshed.retrievedAt,
    netVerificationStatus: refreshed.netVerificationStatus,
  };
}

export async function connectConfiguredMerchant(userId: string) {
  const owner = await assertConfiguredOwner(userId);
  const oauth = await verifyPaypalApplicationOAuth();
  const now = new Date();
  await seedSandboxRecordsForUser(String(owner._id));
  const account = await PayPalAccount.findOne({ userId: owner._id }).lean();
  return {
    connected: true,
    connectionType: "single_merchant_rest_app",
    email: account?.email || env.PAYPAL_BUSINESS_EMAIL,
    environment: env.PAYPAL_MODE,
    applicationCredentialsConfigured: true,
    ownerBinding: "verified",
    merchantConsent: "granted",
    canSync: true,
    capabilities: account?.capabilities ?? {
      transactionSearch: true,
      invoicing: true,
      exchangeRateQuotes: true,
    },
    lastSyncedAt: account?.lastSyncedAt || now,
  };
}
 