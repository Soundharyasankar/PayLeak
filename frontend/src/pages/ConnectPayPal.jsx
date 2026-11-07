import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, ExternalLink, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext.jsx";
import { connectPayPalSandbox } from "../services/paypalService.js";

export default function ConnectPayPal() {
  const { paypal, connectDemo } = useAuth();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const connect = async () => {
    setLoading(true);
    try {
      await connectPayPalSandbox();
      connectDemo();
      toast.success("PayPal Sandbox demo connected.");
    } catch (error) {
      console.error("PayPal connection failed.", error);
      toast.error("Could not connect PayPal. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="onboarding-screen">
      <header className="onboarding-top"><Link to="/" className="login-brand"><span className="brand-mark"><WalletCards size={20} /></span>pay<span>leak</span></Link><span className="demo-pill"><span /> DEMO MODE</span></header>
      <div className="onboarding-progress"><span className="done">1</span><i /><span className={paypal ? "done" : "current"}>2</span><i /><span>3</span><small>Account setup</small></div>
      <section className="connect-card">
        <div className="paypal-mark">P</div>
        <span className="eyebrow">STEP 2 OF 3 · ACCOUNT CONNECTION</span>
        <h1>Connect your PayPal account.</h1>
        <p>PayLeak uses your payment information to help you understand fees, conversion differences, and invoice activity.</p>
        {paypal ? (
          <div className="connected-state">
            <div className="connected-title"><span className="success-icon"><Check size={18} /></span><div><b>Sandbox account connected</b><small>DEMO connection · no live PayPal account used</small></div></div>
            <div className="connection-detail"><span>Account email</span><b>{paypal.email}</b></div>
            <div className="connection-detail"><span>Account type</span><b>PayPal Sandbox</b></div>
            <div className="connection-detail"><span>Status</span><b className="text-green">Connected</b></div>
            <button className="button primary full" onClick={() => navigate("/")}>Go to my dashboard <ArrowRight size={17} /></button>
          </div>
        ) : (
          <>
            <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>Demo Sandbox Connection</b><p>This prototype uses fictional sample data only. It does not connect to PayPal or move money.</p></div></div>
            <button className="button primary full connect-button" onClick={connect} disabled={loading}>{loading ? <span className="spinner" /> : <><span className="paypal-button-p">P</span> Connect PayPal Sandbox <ExternalLink size={16} /></>}</button>
            <button className="button secondary full" onClick={() => { connectDemo(); toast.success("Demo mode is ready."); }}>Continue with sample data</button>
            <div className="secure-note"><LockKeyhole size={15} /> Credentials are never requested or stored by this demo.</div>
          </>
        )}
        <div className="connect-privacy"><span><Check size={14} /> Read-only analysis</span><span><Check size={14} /> You stay in control</span><span><Check size={14} /> Disconnect anytime</span></div>
      </section>
      <p className="onboarding-help">Need a hand? <button className="text-button" onClick={() => toast("Support is available in the full PayLeak product.")}>Contact support</button></p>
    </div>
  );
}
