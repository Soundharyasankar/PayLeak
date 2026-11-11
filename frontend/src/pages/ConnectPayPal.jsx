import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, ExternalLink, LockKeyhole, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { diagnosePaypalAccess, getDefaultPaypalSyncRange, syncTransactions as syncPayPalTransactions } from "../services/transactionService.js";
import { diagnosePaypalInvoices } from "../services/invoiceService.js";

export default function ConnectPayPal() {
  const { paypal, paypalError, refreshPaypalAccount } = useAuth();
  const { refresh } = useAppData();
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [invoiceDiagnostics, setInvoiceDiagnostics] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const verifyAccess = async () => {
    setChecking(true);
    try {
      const [result, invoiceResult] = await Promise.all([
        diagnosePaypalAccess(),
        diagnosePaypalInvoices(),
      ]);
      setDiagnostics(result);
      setInvoiceDiagnostics(invoiceResult);
      await refreshPaypalAccount();
      if (result.canSync && invoiceResult.invoiceApiAccess === "authorized") {
        toast.success("The shared PayPal connection and both API read permissions are verified.");
      } else {
        toast.error([result.guidance, invoiceResult.guidance].filter(Boolean).join(" ") || "One or more PayPal permissions are unavailable.");
      }
    } catch (error) {
      toast.error(error.response?.data?.error?.message || error.message || "Could not verify PayPal access.");
    } finally {
      setChecking(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { startDate, endDate } = getDefaultPaypalSyncRange();
      const result = await syncPayPalTransactions(startDate, endDate);
      await Promise.all([refresh(), refreshPaypalAccount()]);
      setSyncResult(result);
      toast.success(`PayPal returned ${result.paypalTotalRecordsRetrieved}; ${result.totalRecordsInserted} new, ${result.existingRecordsUpdated} refreshed. ${result.totalRecordsStoredInMongoDB} stored in PayLeak.`);
    } catch (error) {
      toast.error(error.response?.data?.error?.message || error.message || "Could not sync PayPal transactions.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="onboarding-screen">
      <header className="onboarding-top"><Link to="/" className="button secondary paypal-back-link"><ArrowLeft size={16} /> Back to Dashboard</Link><Link to="/" className="login-brand"><span className="brand-mark"><WalletCards size={20} /></span>pay<span>leak</span></Link><span className="sandbox-pill"><span /> {paypal?.environment?.toUpperCase() || "SANDBOX"}</span></header>
      <section className="connect-card">
        <div className="paypal-mark">P</div>
        <span className="eyebrow">SHARED PAYPAL INTEGRATION</span>
        <h1>PayPal account access</h1>
        <p>Authenticated PayLeak users share the configured single-merchant PayPal integration. Its credentials remain on the backend; PayPal API permissions are verified independently.</p>
        <div className="sandbox-callout"><WalletCards size={19} /><div><b>Shared account status</b><p>{paypal?.connected ? "Connected and previously verified" : paypal?.applicationCredentialsConfigured ? "Application credentials configured; API access not yet verified" : "Not configured"} · {paypal?.scope === "shared" ? "shared across authenticated PayLeak users" : "shared integration"}</p>{paypal?.email && <p>PayPal account: {paypal.email}</p>}{!paypal?.email && <p>Account email is not returned by PayPal application OAuth.</p>}</div></div>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>PayPal application credentials</b><p>{diagnostics ? `OAuth: ${diagnostics.applicationOAuth}. Environment: ${diagnostics.environment}. App ID: ${diagnostics.paypalOAuthAppId || "not reported"}. Client ID ends ${diagnostics.clientIdLast4 || "unknown"}.` : `Configured: ${paypal?.applicationCredentialsConfigured ? "yes; not verified in this session" : "no"}. Environment: ${paypal?.environment || "sandbox"}.`}</p></div></div>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>OAuth Transaction Search scope</b><p>{diagnostics?.transactionSearchScope || "Not checked"} · required scope: https://uri.paypal.com/services/reporting/search/read</p></div></div>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>Transaction Search API test</b><p>{diagnostics?.transactionSearchApi || (paypal?.capabilities?.transactionSearch ? "Previously verified by successful sync" : "Not tested")}{diagnostics?.transactionSearchHttpStatus != null ? ` · HTTP ${diagnostics.transactionSearchHttpStatus}` : ""}</p></div></div>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>Invoicing API read access</b><p>{invoiceDiagnostics?.invoiceApiAccess || (paypal?.capabilities?.invoicing ? "Previously verified" : "Not tested")}{invoiceDiagnostics?.paypalHttpStatus != null ? ` · HTTP ${invoiceDiagnostics.paypalHttpStatus}` : ""}</p></div></div>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>Last synchronization</b><p>Transactions: {paypal?.lastSyncedAt ? new Date(paypal.lastSyncedAt).toLocaleString() : "Never"} · Invoices: {paypal?.lastInvoiceSyncedAt ? new Date(paypal.lastInvoiceSyncedAt).toLocaleString() : "Never"}</p></div></div>
        <div className="sandbox-callout"><LockKeyhole size={19} /><div><b>PayPal merchant account identity</b><p>Not returned by client-credentials Transaction Search. Verify the app ID’s Sandbox Business account association in the PayPal Developer Dashboard.</p></div></div>
        {diagnostics?.paypalApiError && <div className="paypal-diagnostic-error" role="status"><b>PayPal API response</b><span>HTTP {diagnostics.paypalApiError.httpStatus ?? "unknown"} · {diagnostics.paypalApiError.name || "no error name returned"}</span><span>{diagnostics.paypalApiError.message || "No error message returned."}</span><span>debug_id: {diagnostics.paypalApiError.debugId || "not provided"}</span></div>}
        {invoiceDiagnostics?.paypalApiError && <div className="paypal-diagnostic-error" role="status"><b>PayPal Invoicing API response</b><span>HTTP {invoiceDiagnostics.paypalApiError.httpStatus ?? "unknown"} · {invoiceDiagnostics.paypalApiError.name || "no error name returned"}</span><span>{invoiceDiagnostics.paypalApiError.message || "No error message returned."}</span><span>debug_id: {invoiceDiagnostics.paypalApiError.debugId || "not provided"}</span></div>}
        {diagnostics?.guidance && <div className="inline-error" role="status">{diagnostics.guidance}</div>}
        {invoiceDiagnostics?.guidance && <div className={invoiceDiagnostics.invoiceApiAccess === "authorized" ? "inline-success" : "inline-error"} role="status">{invoiceDiagnostics.guidance}</div>}
        {paypalError && <div className="inline-error" role="alert">{paypalError}</div>}
        {syncResult && <details className="paypal-sync-diagnostics">
          <summary>Latest PayPal sync diagnostics</summary>
          <dl>
            <dt>Integration scope</dt><dd>{syncResult.integrationScope || "shared"}</dd>
            <dt>PayPal OAuth app ID</dt><dd>{syncResult.paypalOAuthAppId || "not reported"}</dd>
            <dt>Client ID suffix</dt><dd>{syncResult.clientIdLast4}</dd>
            <dt>Environment</dt><dd>{syncResult.environment}</dd>
            <dt>Merchant identity</dt><dd>{syncResult.paypalMerchantAccountIdentity}</dd>
            <dt>Date range requested</dt><dd>{syncResult.requestedDateRange.startDate} – {syncResult.requestedDateRange.endDate}</dd>
            <dt>PayPal total_items reported</dt><dd>{syncResult.paypalTotalItemsReported}</dd>
            <dt>Unique records retrieved</dt><dd>{syncResult.paypalTotalRecordsRetrieved} ({syncResult.paypalRawRecordsReturned} API rows)</dd>
            <dt>New records inserted</dt><dd>{syncResult.totalRecordsInserted}</dd>
            <dt>Existing records refreshed</dt><dd>{syncResult.existingRecordsUpdated}</dd>
            <dt>Duplicate IDs skipped</dt><dd>{syncResult.duplicateRecordsSkipped}</dd>
            <dt>Malformed records skipped</dt><dd>{syncResult.invalidRecordsSkipped}</dd>
            <dt>MongoDB records for range</dt><dd>{syncResult.totalRecordsStoredInMongoDBForRange}</dd>
            <dt>Total MongoDB records for user</dt><dd>{syncResult.totalRecordsStoredInMongoDB}</dd>
          </dl>
          <div className="paypal-sync-pages">{syncResult.paypalPages.map((page, index) => <p key={`${page.startDate}-${page.page}-${index}`}>
            HTTP {page.httpStatus ?? "unknown"} · {page.startDate} – {page.endDate} · page {page.page}/{page.totalPages} · total_items {page.totalItems} · page_size {page.pageSize} · transaction_details {page.transactionDetails}
          </p>)}</div>
        </details>}
        <button className="button secondary full" onClick={verifyAccess} disabled={checking}>{checking ? <span className="spinner" /> : <ShieldCheck size={16} />} Verify PayPal API access</button>
        <button className="button primary full connect-button" onClick={sync} disabled={syncing || checking || !(diagnostics?.canSync ?? paypal?.canSync)}>{syncing ? <span className="spinner" /> : <><RefreshCw size={16} /> Sync PayPal transactions</>}</button>
        <Link className="button secondary full" to="/paypal/sandbox-checkout"><span className="paypal-button-p">P</span> Test Sandbox Checkout <ExternalLink size={15} /></Link>
        <div className="secure-note"><LockKeyhole size={15} /> Client credentials and short-lived OAuth tokens stay on the backend. OAuth success does not imply that PayPal has granted each API permission.</div>
        <div className="connect-privacy"><span><Check size={14} /> Sandbox only</span><span><Check size={14} /> Server-verified captures</span><span><Check size={14} /> No card data stored</span></div>
      </section>
      <p className="onboarding-help">Configure the single-merchant PayPal REST app once in the backend environment. If either API returns HTTP 403, verify the app-to-business association and API permissions in the PayPal Developer Dashboard and share the error name/debug ID with PayPal Support. Sandbox Checkout permission does not imply Transaction Search or Invoicing API access.</p>
    </div>
  );
}
