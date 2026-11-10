import { useState } from "react";
import {Link } from "react-router-dom";
import { Check, ExternalLink, LockKeyhole, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { diagnosePaypalAccess, getDefaultPaypalSyncRange, syncTransactions as syncPayPalTransactions } from "../services/transactionService.js";

export default function ConnectPayPal() {
  const { paypal, paypalError, refreshPaypalAccount } = useAuth();
  const { refresh } = useAppData();
  const [syncing, setSyncing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [syncResult, setSyncResult] = useState(null);

  const verifyAccess = async () => {
    setChecking(true);
    try {
      const result = await diagnosePaypalAccess();
      setDiagnostics(result);
      await refreshPaypalAccount();
      if (result.canSync) toast.success("PayPal OAuth and Transaction Search are available.");
      else toast.error(result.guidance || "PayPal access is incomplete.");
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
      <header className="onboarding-top"><Link to="/" className="login-brand"><span className="brand-mark"><WalletCards size={20} /></span>pay<span>leak</span></Link><span className="sandbox-pill"><span /> SANDBOX</span></header>
      <section className="connect-card">
        <div className="paypal-mark">P</div>
        <span className="eyebrow">PAYPAL MERCHANT ACCESS</span>
        <h1>Review PayPal account access.</h1>
        <p>PayLeak first verifies application OAuth, Transaction Search permission, and the configured single-merchant PayLeak owner. App credentials alone do not link a seller account.</p>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>PayPal application credentials</b><p>{diagnostics ? `OAuth: ${diagnostics.applicationOAuth}. Environment: ${diagnostics.environment}. App ID: ${diagnostics.paypalOAuthAppId || "not reported"}. Client ID ends ${diagnostics.clientIdLast4 || "unknown"}.` : `Configured: ${paypal?.applicationCredentialsConfigured ? "yes; not verified in this session" : "no"}. Environment: ${paypal?.environment || "sandbox"}.`}</p></div></div>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>OAuth Transaction Search scope</b><p>{diagnostics?.transactionSearchScope || "Not checked"} · required scope: https://uri.paypal.com/services/reporting/search/read</p></div></div>
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>Transaction Search API test</b><p>{diagnostics?.transactionSearchApi || (paypal?.capabilities?.transactionSearch ? "Previously verified by successful sync" : "Not tested")}{diagnostics?.transactionSearchHttpStatus != null ? ` · HTTP ${diagnostics.transactionSearchHttpStatus}` : ""}</p></div></div>
        <div className="sandbox-callout"><LockKeyhole size={19} /><div><b>PayLeak owner binding</b><p>{diagnostics ? `${diagnostics.ownerBinding.replaceAll("_", " ")} · user ID ${diagnostics.payLeakUserId}` : paypal?.ownerBinding?.replaceAll("_", " ") || "Not configured"}</p></div></div>
        <div className="sandbox-callout"><LockKeyhole size={19} /><div><b>PayPal merchant account identity</b><p>Not returned by client-credentials Transaction Search. Verify the app ID’s Sandbox Business account association in the PayPal Developer Dashboard.</p></div></div>
        <div className="sandbox-callout"><LockKeyhole size={19} /><div><b>Merchant consent</b><p>Not required for the single-merchant app model. Third-party seller onboarding requires eligible PayPal partner approval.</p></div></div>
        {diagnostics?.paypalApiError && <div className="paypal-diagnostic-error" role="status"><b>PayPal API response</b><span>HTTP {diagnostics.paypalApiError.httpStatus ?? "unknown"} · {diagnostics.paypalApiError.name || "no error name returned"}</span><span>{diagnostics.paypalApiError.message || "No error message returned."}</span><span>debug_id: {diagnostics.paypalApiError.debugId || "not provided"}</span></div>}
        {diagnostics?.guidance && <div className="inline-error" role="status">{diagnostics.guidance}</div>}
        {paypalError && <div className="inline-error" role="alert">{paypalError}</div>}
        {syncResult && <details className="paypal-sync-diagnostics">
          <summary>Latest PayPal sync diagnostics</summary>
          <dl>
            <dt>PayLeak user ID</dt><dd>{syncResult.payLeakUserId}</dd>
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
        <div className="secure-note"><LockKeyhole size={15} /> Client credentials and short-lived OAuth tokens stay on the backend. A successful OAuth check does not imply seller consent.</div>
        <div className="connect-privacy"><span><Check size={14} /> Sandbox only</span><span><Check size={14} /> Server-verified captures</span><span><Check size={14} /> No card data stored</span></div>
      </section>
      <p className="onboarding-help">For one merchant, configure the Merchant REST app owned by that Sandbox Business account and bind the verified PayLeak user by immutable MongoDB user ID. If the required scope is present but API access still returns 403, provide PayPal Developer Support the error name and debug ID and ask them to verify the app-to-business association/capability. Connecting separate merchants requires PayPal partner approval and seller-consent permissions. Sandbox Checkout does not authorize Transaction Search.</p>
    </div>
  );
}
