import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, CheckCircle2, CircleAlert } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import { captureSandboxOrder, cancelSandboxOrder } from "../services/paypalCheckoutService.js";
import { useAppData } from "../context/AppContext.jsx";

export function PayPalCaptureReturn() {
  const location = useLocation();
  const { refresh } = useAppData();
  const orderId = new URLSearchParams(location.search).get("token");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!orderId) {
      setError("PayPal did not return an order reference. No payment was captured.");
      return () => { active = false; };
    }
    captureSandboxOrder(orderId)
      .then(async (capture) => {
        if (!active) return;
        setResult(capture);
        await refresh();
      })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.error?.message || "PayPal capture could not be verified. No successful payment is reported.");
      });
    return () => { active = false; };
  }, [orderId, refresh]);

  return <div className="page-enter"><PageHeader eyebrow="PAYPAL SANDBOX" title={result ? "Payment captured" : error ? "Capture not verified" : "Verifying PayPal capture"} description="PayLeak records a payment only after the backend confirms a completed PayPal capture." /><section className="panel empty-state">{result ? <><CheckCircle2 size={26} /><b>PayPal confirmed capture {result.captureId}</b><span>Order {result.orderId} · {result.status} · transaction stored: {String(result.transactionStored)}</span></> : error ? <><CircleAlert size={25} /><b>Payment was not confirmed</b><span>{error}</span></> : <><span className="spinner" /><b>Checking the PayPal order with the backend…</b></>}<Link className="button secondary" to="/"><ArrowLeft size={15} /> Return to dashboard</Link></section></div>;
}

export function PayPalCancelReturn() {
  const location = useLocation();
  const orderId = new URLSearchParams(location.search).get("token");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!orderId) {
      setError("PayPal did not return an order reference. No capture request was made.");
      return () => { active = false; };
    }
    cancelSandboxOrder(orderId)
      .then((value) => { if (active) setResult(value); })
      .catch((requestError) => {
        if (active) setError(requestError.response?.data?.error?.message || "Could not verify the cancelled PayPal order.");
      });
    return () => { active = false; };
  }, [orderId]);

  return <div className="page-enter"><PageHeader eyebrow="PAYPAL SANDBOX" title="Checkout not completed" description="A buyer cancellation does not trigger a capture." /><section className="panel empty-state">{error ? <><CircleAlert size={25} /><b>Cancellation status unavailable</b><span>{error}</span></> : result ? <><CheckCircle2 size={26} /><b>{result.captured ? "PayPal reports a completed payment" : "No payment was captured"}</b><span>{result.orderId} · PayPal status: {result.status}{result.cancellationConfirmed === false ? " · PayPal has not confirmed a voided order." : ""}</span></> : <><span className="spinner" /><b>Checking PayPal order status…</b></>}<Link className="button secondary" to="/paypal/sandbox-checkout"><ArrowLeft size={15} /> Back to Sandbox test</Link></section></div>;
}
