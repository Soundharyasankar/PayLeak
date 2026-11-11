import { env } from "../config/env.js";
import { PayPalIntegration } from "../models/PayPalIntegration.ts";
import { Transaction } from "../models/Transaction.js";
import { AppError } from "../utils/errors.js";
import { paypalRequest, verifyPaypalApplicationOAuth } from "./paypalClient.js";
import { calculatePaypalTransactionValues, explainNetMismatch } from "./analytics/paypalCalculationService.js";
import { getSharedPaypalIntegration, updateSharedPaypalIntegration } from "./paypalIntegrationService.js";

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

export async function getPaypalAccount(userId: string) {
  const integration = await getSharedPaypalIntegration(userId);
  const environment = env.PAYPAL_MODE;
  const applicationCredentialsConfigured = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  const capabilities = (integration.environment === environment
    ? integration.capabilities ?? {
        transactionSearch: false,
        invoicing: false,
        exchangeRateQuotes: false,
      }
    : {
        transactionSearch: false,
        invoicing: false,
        exchangeRateQuotes: false,
      });
  return {
    connected: applicationCredentialsConfigured && Boolean(capabilities.transactionSearch || capabilities.invoicing),
    connectionType: "shared_application_credentials",
    scope: "shared",
    email: integration.accountEmailVerified ? integration.accountEmail : null,
    environment,
    applicationCredentialsConfigured,
    canSync: applicationCredentialsConfigured && Boolean(capabilities.transactionSearch),
    capabilities,
    lastSyncedAt: integration.lastSyncedAt,
    lastInvoiceSyncedAt: integration.lastInvoiceSyncedAt,
  };
}

export async function diagnosePaypalAccess(userId: string) {
  const integration = await getSharedPaypalIntegration(userId);
  const result = {
    integrationScope: "shared",
    environment: env.PAYPAL_MODE,
    paypalOAuthAppId: null as string | null,
    clientIdLast4: env.PAYPAL_CLIENT_ID ? env.PAYPAL_CLIENT_ID.slice(-4) : null,
    paypalMerchantAccountIdentity: "not_returned_by_client_credentials_transaction_search",
    applicationOAuth: env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? "not_verified" : "not_configured",
    transactionSearchScope: "not_tested",
    transactionSearchApi: "not_tested",
    transactionSearchHttpStatus: null as number | null,
    canSync: false,
    guidance: "",
    paypalApiError: null as null | {
      httpStatus: number | null;
      name: string | null;
      message: string | null;
      debugId: string | null;
    },
  };

  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    result.guidance = "Configure the PayPal REST app credentials for the selected environment on the backend.";
    return result;
  }

  try {
    const oauth = await verifyPaypalApplicationOAuth();
    result.applicationOAuth = "verified";
    result.transactionSearchScope = oauth.transactionSearchScope;
    result.paypalOAuthAppId = oauth.appId;
  } catch (error) {
    result.applicationOAuth = error instanceof AppError && error.code === "PAYPAL_AUTH_FAILED" ? "rejected" : "unavailable";
    result.guidance = error instanceof AppError ? error.message : "PayPal OAuth verification failed.";
    return result;
  }

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString(),
    fields: "all",
    page_size: "1",
    page: "1",
  });
  try {
    await paypalRequest<PaypalSearchResponse>(
      `/v1/reporting/transactions?${query.toString()}`,
      {},
      (status) => { result.transactionSearchHttpStatus = status; },
    );
    result.transactionSearchApi = "authorized";
    await PayPalIntegration.updateOne(
      { _id: integration._id },
      { $set: { "capabilities.transactionSearch": true } },
    );
  } catch (error) {
    result.transactionSearchApi = error instanceof AppError && error.code === "PAYPAL_PERMISSION_DENIED"
      ? "permission_denied"
      : "unavailable";
    if (result.transactionSearchApi === "permission_denied") {
      await PayPalIntegration.updateOne(
        { _id: integration._id },
        { $set: { "capabilities.transactionSearch": false } },
      );
    }
    const diagnostic = error instanceof AppError
      ? (error.diagnostic && typeof error.diagnostic === "object" ? error.diagnostic as Record<string, unknown> : (
        error.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {}))
      : {};
    if (error instanceof AppError && Object.keys(diagnostic).length > 0) {
      result.paypalApiError = {
        httpStatus: typeof diagnostic.httpStatus === "number" ? diagnostic.httpStatus : null,
        name: typeof diagnostic.paypalErrorName === "string" ? diagnostic.paypalErrorName : null,
        message: typeof diagnostic.paypalMessage === "string" ? diagnostic.paypalMessage : null,
        debugId: typeof diagnostic.debugId === "string" ? diagnostic.debugId : null,
      };
    }
    result.guidance = error instanceof AppError
      ? error.message
      : "PayPal Transaction Search permission could not be verified.";
  }

  result.canSync = result.applicationOAuth === "verified"
    && result.transactionSearchApi === "authorized";
  if (!result.guidance && result.transactionSearchApi === "permission_denied") {
    result.guidance = "The API returned HTTP 403 despite the OAuth check. Use PayPal's error and debug ID with PayPal Developer Support to verify app type, merchant ownership, and Sandbox account capability.";
  } else if (!result.guidance && result.transactionSearchApi !== "authorized") {
    result.guidance = "The Transaction Search API request did not succeed.";
  } else if (!result.guidance && result.transactionSearchScope === "missing") {
    result.guidance = "PayPal authorized Transaction Search even though the OAuth response omitted its reporting scope claim. The actual API request succeeded.";
  } else if (!result.guidance && result.transactionSearchScope === "not_reported") {
    result.guidance = "PayPal authorized Transaction Search. The OAuth response did not report scopes.";
  } else if (!result.guidance && result.canSync) {
    result.guidance = "The shared PayPal integration is authenticated and Transaction Search is available.";
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
  const integration = await getSharedPaypalIntegration(userId);
  const dataScopeId = integration.dataScopeId;
  let oauth: Awaited<ReturnType<typeof verifyPaypalApplicationOAuth>>;
  try {
    oauth = await verifyPaypalApplicationOAuth();
  } catch (error) {
    throw addSyncFailureContext(error, {
      integrationScope: "shared",
      clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
      environment: env.PAYPAL_MODE,
      requestedDateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
  }
  let search: Awaited<ReturnType<typeof getTransactionSearchData>>;
  try {
    search = await getTransactionSearchData(startDate, endDate);
  } catch (error) {
    throw addSyncFailureContext(error, {
      integrationScope: "shared",
      paypalOAuthAppId: oauth.appId,
      clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
      environment: env.PAYPAL_MODE,
      requestedDateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
  }
  const { items } = search;
  const retrievedAt = new Date();
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
  let totalRecordsInserted = 0;
  let existingRecordsUpdated = 0;
  for (const transaction of transactions) {
    const result = await Transaction.updateOne(
      { userId: dataScopeId, paypalTransactionId: transaction.paypalTransactionId },
      { $set: { ...transaction, userId: dataScopeId } },
      { upsert: true, runValidators: true },
    );
    totalRecordsInserted += result.upsertedCount;
    existingRecordsUpdated += result.matchedCount;
  }
  const requestedRange = { $gte: startDate, $lte: endDate };
  const [totalRecordsStored, totalRecordsStoredInRange] = await Promise.all([
    Transaction.countDocuments({ userId: dataScopeId }),
    Transaction.countDocuments({ userId: dataScopeId, transactionDate: requestedRange }),
  ]);
  const diagnostics = {
    integrationScope: "shared",
    paypalOAuthAppId: oauth.appId,
    clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
    paypalMerchantAccountIdentity: "not_returned_by_client_credentials_transaction_search",
    environment: env.PAYPAL_MODE,
    requestedDateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    paypalTotalItemsReported: search.totalItemsReported,
    paypalTotalRecordsRetrieved: items.length,
    paypalRawRecordsReturned: search.rawRecordsReturned,
    paypalPages: search.pages,
    totalRecordsInserted,
    existingRecordsUpdated,
    duplicateRecordsSkipped: search.duplicateTransactionIdsSkipped,
    invalidRecordsSkipped: items.length - transactions.length,
    totalRecordsStoredInMongoDB: totalRecordsStored,
    totalRecordsStoredInMongoDBForRange: totalRecordsStoredInRange,
  };
  console.info("PayPal transaction sync", JSON.stringify(diagnostics));
  await updateSharedPaypalIntegration(userId,
    {
      $set: {
        lastSyncedAt: retrievedAt,
        "capabilities.transactionSearch": true,
      },
    },
  );
  return {
    ...diagnostics,
    syncedTransactionIds: transactions.map((transaction) => transaction.paypalTransactionId),
    retrieved: items.length,
    stored: totalRecordsInserted,
    skipped: search.duplicateTransactionIdsSkipped + items.length - transactions.length,
    lastSyncedAt: retrievedAt,
  };
}

export async function refreshPaypalTransaction(userId: string, transactionId: string) {
  const integration = await getSharedPaypalIntegration(userId);
  const existing = await Transaction.findOne({
    paypalTransactionId: transactionId,
    $or: [{ userId }, { userId: integration.dataScopeId }],
  }).select("transactionDate");
  if (!existing) throw new AppError(404, "Transaction not found.", "TRANSACTION_NOT_FOUND");
  const startDate = new Date(existing.transactionDate.getTime() - 3 * 24 * 60 * 60 * 1000);
  const endDate = new Date(existing.transactionDate.getTime() + 3 * 24 * 60 * 60 * 1000);
  const sync = await syncPaypalTransactions(userId, startDate, endDate);
  if (!sync.syncedTransactionIds.includes(transactionId)) {
    throw new AppError(404, "PayPal did not return this transaction in the refresh response.", "PAYPAL_TRANSACTION_NOT_RETURNED");
  }
  const refreshed = await Transaction.findOne({ userId: integration.dataScopeId, paypalTransactionId: transactionId })
    .select("paypalTransactionId retrievedAt netVerificationStatus");
  if (!refreshed) throw new AppError(500, "The refreshed PayPal transaction could not be loaded.", "PAYPAL_TRANSACTION_REFRESH_FAILED");
  return {
    transactionId: refreshed.paypalTransactionId,
    retrievedAt: refreshed.retrievedAt,
    netVerificationStatus: refreshed.netVerificationStatus,
  };
}

export async function connectConfiguredMerchant(userId: string) {
  await getSharedPaypalIntegration(userId);
  throw new AppError(501, "PayPal user-consent OAuth/partner onboarding is not available in this deployment. Configure an eligible merchant/partner integration before connecting accounts.", "PAYPAL_OAUTH_UNAVAILABLE");
}
