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
  const [canSync, setCanSync] = useState(null);

  const verifyAccess = async () => {
    setChecking(true);
    try {
      const [transactionResult, invoiceResult] = await Promise.all([
        diagnosePaypalAccess(),
        diagnosePaypalInvoices(),
      ]);
      setCanSync(transactionResult.canSync);
      await refreshPaypalAccount();
      if (!transactionResult.canSync) {
        toast.error("Unable to verify PayPal access. Please check your PayPal connection.");
      } else if (invoiceResult.invoiceApiAccess !== "authorized") {
        toast.error("PayPal Invoicing API access is currently unavailable. Please contact your administrator.");
      } else {
        toast.success("PayPal connection verified successfully.");
      }
    } catch {
      toast.error("Unable to verify PayPal access. Please check your PayPal connection.");
    } finally {
      setChecking(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { startDate, endDate } = getDefaultPaypalSyncRange();
      await syncPayPalTransactions(startDate, endDate);
      await Promise.all([refresh(), refreshPaypalAccount()]);
      toast.success("PayPal transactions synchronized successfully.");
    } catch {
      toast.error("Unable to synchronize PayPal transactions. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="onboarding-screen">
      <header className="onboarding-top"><Link to="/" className="button secondary paypal-back-link"><ArrowLeft size={16} /> Back to Dashboard</Link><Link to="/" className="login-brand"><span className="brand-mark"><WalletCards size={20} /></span>pay<span>leak</span></Link><span className="sandbox-pill"><span /> PayPal Sandbox</span></header>
      <section className="connect-card">
        <div className="paypal-mark">P</div>
        <span className="eyebrow">SHARED PAYPAL INTEGRATION</span>
        <h1>PayPal account access</h1>
        <p>PayLeak users share the configured PayPal integration. No individual PayPal connection is required.</p>
        <div className="sandbox-callout"><WalletCards size={19} /><div><b>Shared account status</b><p>{paypal?.connected ? "PayPal Sandbox Connected" : "PayPal connection is not currently verified."}</p></div></div>
        {paypalError && <div className="inline-error" role="alert">PayPal connection status is currently unavailable.</div>}
        <button className="button secondary full" onClick={verifyAccess} disabled={checking || syncing}>{checking ? <span className="spinner" /> : <ShieldCheck size={16} />} Verify PayPal access</button>
        <button className="button primary full connect-button" onClick={sync} disabled={syncing || checking || !(canSync ?? paypal?.canSync)}>{syncing ? <span className="spinner" /> : <><RefreshCw size={16} /> Sync PayPal transactions</>}</button>
        <Link className="button secondary full" to="/paypal/sandbox-checkout"><span className="paypal-button-p">P</span> Test Sandbox Checkout <ExternalLink size={15} /></Link>
        <div className="secure-note"><LockKeyhole size={15} /> PayPal credentials and access tokens are securely managed by the PayLeak backend.</div>
        <div className="connect-privacy"><span><Check size={14} /> Sandbox only</span><span><Check size={14} /> Server-verified captures</span><span><Check size={14} /> No card data stored</span></div>
      </section>
    </div>
  );
}
