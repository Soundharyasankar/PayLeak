import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  app_id?: string;
}

const transactionSearchScope = "https://uri.paypal.com/services/reporting/search/read";
let tokenCache: { value: string; expiresAt: number; scopes: string[]; appId: string | null } | undefined;
const invoiceReadScope = "https://uri.paypal.com/services/invoicing/invoices/read";
const invoiceWriteScope = "https://uri.paypal.com/services/invoicing/invoices/write";

async function getAccessToken(forceRefresh = false) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new AppError(503, "PayPal API credentials are not configured.", "PAYPAL_NOT_CONFIGURED");
  }
  if (forceRefresh) tokenCache = undefined;
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache;

  let response: Response;
  try {
    response = await fetch(`${env.PAYPAL_BASE_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(502, "PayPal token service could not be reached.", "PAYPAL_CONNECTION_FAILED");
  }
  if (!response.ok) {
    tokenCache = undefined;
    let payload: { error?: unknown; error_description?: unknown; debug_id?: unknown } = {};
    try {
      payload = await response.json() as typeof payload;
    } catch {
      // Preserve the HTTP result if PayPal returns a non-JSON authentication error.
    }
    throw new AppError(
      502,
      "PayPal rejected the configured application credentials for this environment.",
      "PAYPAL_AUTH_FAILED",
      {
        httpStatus: response.status,
        paypalErrorName: typeof payload.error === "string" ? payload.error : null,
        paypalMessage: typeof payload.error_description === "string" ? payload.error_description : null,
        debugId: typeof payload.debug_id === "string" ? payload.debug_id : null,
      },
    );
  }
  let payload: Partial<TokenResponse>;
  try {
    payload = await response.json() as Partial<TokenResponse>;
  } catch {
    throw new AppError(502, "PayPal returned an invalid token response.", "PAYPAL_INVALID_RESPONSE");
  }
  if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") {
    throw new AppError(502, "PayPal returned an invalid token response.", "PAYPAL_INVALID_RESPONSE");
  }
  tokenCache = {
    value: payload.access_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
    scopes: typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [],
    appId: typeof payload.app_id === "string" ? payload.app_id : null,
  };
  return tokenCache;
}

export async function verifyPaypalApplicationOAuth() {
  const token = await getAccessToken(true);
  return {
    authenticated: true,
    transactionSearchScope: token.scopes.length === 0
      ? "not_reported"
      : token.scopes.includes(transactionSearchScope) ? "present" : "missing",
    appId: token.appId,
    clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
  };
}

export async function verifyPaypalInvoiceOAuth() {
  const token = await getAccessToken(true);
  return {
    authenticated: true,
    invoiceReadScope: token.scopes.length === 0
      ? "not_reported"
      : token.scopes.includes(invoiceReadScope) ? "present" : "missing",
    invoiceWriteScope: token.scopes.length === 0
      ? "not_reported"
      : token.scopes.includes(invoiceWriteScope) ? "present" : "missing",
    appId: token.appId,
    clientIdLast4: env.PAYPAL_CLIENT_ID.slice(-4),
  };
}

export async function paypalRequest<T>(
  path: string,
  init: RequestInit = {},
  onResponse?: (status: number) => void,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getAccessToken();
    let response: Response;
    try {
      response = await fetch(`${env.PAYPAL_BASE_URL}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...init.headers, Authorization: `Bearer ${token.value}` },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError(502, "PayPal API could not be reached.", "PAYPAL_CONNECTION_FAILED");
    }
    onResponse?.(response.status);

    if (response.status === 401 && attempt === 0) {
      tokenCache = undefined;
      continue;
    }

    if (response.status === 401) {
      tokenCache = undefined;
      throw new AppError(502, "PayPal rejected the refreshed application token.", "PAYPAL_TOKEN_REJECTED");
    }
    if (!response.ok) {
      let payload: {
        name?: unknown;
        message?: unknown;
        debug_id?: unknown;
        details?: Array<{ issue?: unknown; description?: unknown }>;
      } = {};
      try {
        payload = await response.json() as typeof payload;
      } catch {
        // Keep the HTTP status when PayPal returns a non-JSON error.
      }
      const paypalErrorName = typeof payload.name === "string" ? payload.name : null;
      const debugId = typeof payload.debug_id === "string" ? payload.debug_id : null;
      const paypalIssues = (payload.details ?? []).flatMap((detail) => {
        const issue = typeof detail.issue === "string" ? detail.issue : null;
        const description = typeof detail.description === "string" ? detail.description : null;
        return issue || description ? [{ issue, description }] : [];
      });
      const unsupportedCurrency = response.status === 400 && paypalIssues.some(({ issue, description }) =>
        issue === "CURRENCY_NOT_SUPPORTED"
        || (description ?? "").toLowerCase().includes("currency code is not valid"),
      );
      console.error("PayPal API request rejected", {
        method: init.method ?? "GET",
        endpoint: path.split("?")[0],
        httpStatus: response.status,
        paypalErrorName,
        paypalIssueCodes: paypalIssues.map(({ issue }) => issue).filter(Boolean),
        currencyRejected: unsupportedCurrency,
        debugId,
      });
      if (unsupportedCurrency) {
        throw new AppError(
          422,
          "This currency is not available for your PayPal account. Choose another currency.",
          "PAYPAL_CURRENCY_UNSUPPORTED",
        );
      }
      if (response.status === 400) {
        throw new AppError(
          422,
          "PayPal could not accept the invoice details. Check the currency and invoice information.",
          "PAYPAL_INVALID_REQUEST",
        );
      }
      throw new AppError(
        response.status === 403 || response.status === 429 || response.status >= 500 ? 503 : 502,
        response.status === 403
          ? "PayPal denied this API request. Check the app permissions and Sandbox merchant association."
          : response.status === 429 || response.status >= 500
            ? "PayPal is temporarily unavailable. Please try again later."
          : `PayPal API request failed with status ${response.status}.`,
        response.status === 403 ? "PAYPAL_PERMISSION_DENIED" : "PAYPAL_API_ERROR",
        undefined,
        response.status === 403
          ? {
              httpStatus: response.status,
              paypalErrorName,
              paypalMessage: typeof payload.message === "string" ? payload.message : null,
              debugId,
            }
          : {
              httpStatus: response.status,
              paypalErrorName,
              paypalMessage: typeof payload.message === "string" ? payload.message : null,
              debugId,
            },
      );
    }
    if (response.status === 204) return undefined as T;
    try {
      return await response.json() as T;
    } catch {
      throw new AppError(502, "PayPal returned an invalid API response.", "PAYPAL_INVALID_RESPONSE");
    }
  }

  throw new AppError(502, "PayPal authentication could not be refreshed.", "PAYPAL_TOKEN_REJECTED");
}

export function clearPaypalTokenCache() {
  tokenCache = undefined;
}
