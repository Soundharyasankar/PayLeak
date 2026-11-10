import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import { fetchPayPalConfig, createSandboxOrder } from "../services/paypalCheckoutService.js";

export default function SandboxCheckout() {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState("");
  const [form, setForm] = useState({ amount: "", currency: "USD", description: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    fetchPayPalConfig()
      .then((result) => { if (active) setConfig(result); })
      .catch((error) => { if (active) setConfigError(error.response?.data?.error?.message || "Could not check PayPal Sandbox configuration."); });
    return () => { active = false; };
  }, []);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const startCheckout = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const order = await createSandboxOrder({ ...form, idempotencyKey: crypto.randomUUID() });
      window.location.assign(order.approvalUrl);
    } catch (error) {
      const message = error.response?.data?.error?.message || error.message || "Could not create a PayPal Sandbox order.";
      toast.error(message);
      setLoading(false);
    }
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="PAYPAL / SANDBOX CHECKOUT" title="Test a Sandbox payment" description="Create an actual PayPal Sandbox order. Approve with a separate Sandbox Personal buyer account; PayLeak captures and records it server-side." action={<Link className="button secondary" to="/connect-paypal"><ArrowLeft size={16} /> PayPal access</Link>} />
      <section className="panel form-panel sandbox-checkout-panel">
        <div className="sandbox-callout"><ShieldCheck size={19} /><div><b>Sandbox only · no live payment</b><p>{configError || (config ? config.checkoutConfigured ? "Server is configured to use PayPal Sandbox." : "Sandbox REST app credentials are not configured on the backend." : "Checking backend PayPal configuration…")}</p></div></div>
        <form className="form-grid sandbox-checkout-form" onSubmit={startCheckout}>
          <label className="field-label">Amount *<input type="number" min="0.01" max="9999999.99" step="0.01" required value={form.amount} onChange={(event) => update("amount", event.target.value)} placeholder="25.00" /></label>
          <label className="field-label">Currency<select value={form.currency} onChange={(event) => update("currency", event.target.value)}>{["USD", "EUR", "GBP", "CAD", "AUD"].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="field-label full-span">Description *<input required maxLength={127} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Sandbox order description" /></label>
          <div className="form-actions full-span"><button className="button primary" type="submit" disabled={loading || !config?.checkoutConfigured || Boolean(configError)}>{loading ? <span className="spinner" /> : <>Continue to PayPal Sandbox <ExternalLink size={15} /></>}</button></div>
        </form>
        <p className="muted small-copy">The PayPal buyer approval is not treated as payment. A completed PayPal capture response is required before a transaction is saved or displayed.</p>
      </section>
    </div>
  );
}
