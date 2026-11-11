import { useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function PaypalConnected() {
  const { paypal, paypalWelcomePending, finishPaypalWelcome } = useAuth();
  const navigate = useNavigate();
  const isConnected = Boolean(paypalWelcomePending && paypal?.connected);

  useEffect(() => {
    if (!isConnected) {
      finishPaypalWelcome();
      navigate("/", { replace: true });
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      finishPaypalWelcome();
      navigate("/", { replace: true });
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [finishPaypalWelcome, isConnected, navigate]);

  if (!isConnected) return null;

  const title = paypal.environment === "sandbox"
    ? "PayPal Sandbox Connected Successfully!"
    : "PayPal Connected Successfully!";

  return (
    <main className="paypal-success-screen" role="status" aria-live="polite">
      <section className="paypal-success-card">
        <CheckCircle2 className="paypal-success-icon" size={58} strokeWidth={1.8} aria-hidden="true" />
        <span className="eyebrow">SHARED PAYPAL INTEGRATION</span>
        <h1>{title}</h1>
        <p>Your PayLeak account is ready to access the shared PayPal integration.</p>
        <small>Taking you to your dashboard…</small>
      </section>
    </main>
  );
}
