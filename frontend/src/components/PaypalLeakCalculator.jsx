import { useMemo, useState } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";
import Panel from "./Panel.jsx";
import { calculatePaypalLeak, PAYPAL_LEAK_CONFIG } from "../utils/paypalLeakCalculator.js";

const currencies = ["USD", "EUR", "GBP", "AUD", "CAD", "SGD", "INR"];
const scenarioGrossAmounts = [100, 500, 1000, 5000, 10000];
const workedExample = calculatePaypalLeak({
  gross: 1000,
  currency: "USD",
  midRate: 90,
  includeGst: true,
});

function formatForeign(value, currency) {
  if (value == null) return "—";
  return `${currency} ${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRupees(value) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRate(value) {
  return `₹${Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function formatPercent(value) {
  return `${Number(value).toFixed(2)}%`;
}

function makeSteps(result, includeGst) {
  const { currency, gross, midRate, percentFee, fixedFee, totalFee, gst, netForeign, paypalRate, inrCredited, midMarketValue, totalLossINR, totalLossPercent, spread } = result;
  const fixedFeeLabel = formatForeign(fixedFee, currency);
  const feePercent = formatPercent(PAYPAL_LEAK_CONFIG.percentFee * 100);
  const gstPercent = formatPercent(PAYPAL_LEAK_CONFIG.gstRate * 100);
  return [
    { step: "1", action: "PayPal applies its percentage transaction fee.", formula: `${formatForeign(gross, currency)} × ${feePercent}`, foreign: formatForeign(percentFee, currency), inr: formatRupees(percentFee * midRate) },
    { step: "2", action: "PayPal adds the fixed fee for the received currency.", formula: `Fixed fee for ${currency}`, foreign: fixedFeeLabel, inr: formatRupees(fixedFee * midRate) },
    { step: "3", action: "Combine percentage and fixed transaction fees.", formula: "Step 1 + Step 2", foreign: formatForeign(totalFee, currency), inr: formatRupees(totalFee * midRate) },
    { step: "4", action: includeGst ? "Apply GST to PayPal fees only." : "GST is excluded by the input toggle.", formula: includeGst ? `${formatForeign(totalFee, currency)} × ${gstPercent}` : "GST toggle OFF", foreign: formatForeign(gst, currency), inr: formatRupees(gst * midRate) },
    { step: "5", action: "Subtract fees and GST before conversion.", formula: `${formatForeign(gross, currency)} − Step 3 − Step 4`, foreign: formatForeign(netForeign, currency), inr: formatRupees(netForeign * midRate) },
    { step: "6", action: currency === "INR" ? "No currency conversion for INR receipts." : "Model PayPal's rate after the selected conversion spread.", formula: currency === "INR" ? "Not applicable for INR" : `${formatRate(midRate)} × (1 − ${formatPercent(spread * 100)})`, foreign: "—", inr: formatRate(paypalRate) },
    { step: "7", action: currency === "INR" ? "Net amount is already in INR." : "Convert the post-fee foreign amount at PayPal's modeled rate.", formula: currency === "INR" ? "Step 5" : "Step 5 × Step 6", foreign: formatForeign(netForeign, currency), inr: formatRupees(inrCredited) },
    { step: "8", action: "Value the original gross payment at the mid-market estimate.", formula: `${formatForeign(gross, currency)} × ${formatRate(midRate)}`, foreign: formatForeign(gross, currency), inr: formatRupees(midMarketValue) },
    { step: "9", action: "Compare mid-market value with estimated bank credit.", formula: "Step 8 − Step 7", foreign: "—", inr: formatRupees(totalLossINR) },
    { step: "10", action: "Express the modeled loss as a share of the mid-market value.", formula: "Step 9 ÷ Step 8 × 100", foreign: "—", inr: formatPercent(totalLossPercent) },
  ];
}

export default function PaypalLeakCalculator() {
  const [grossInput, setGrossInput] = useState("1000");
  const [currency, setCurrency] = useState("USD");
  const [rateInput, setRateInput] = useState("90");
  const [includeGst, setIncludeGst] = useState(true);
  const [conversionMode, setConversionMode] = useState("receivedPayment");
  const [actualInput, setActualInput] = useState("");

  const gross = Number(grossInput);
  const midRate = currency === "INR" ? 1 : Number(rateInput);
  const validInputs = Number.isFinite(gross) && gross > 0
    && Number.isFinite(midRate) && midRate > 0;
  const result = useMemo(() => {
    if (!validInputs) return null;
    return calculatePaypalLeak({ gross, currency, midRate, includeGst, conversionMode });
  }, [validInputs, gross, currency, midRate, includeGst, conversionMode]);
  const steps = result ? makeSteps(result, includeGst) : [];
  const breakdownItems = result ? [
    { key: "transactionFees", label: "Transaction + fixed fee leak", amount: result.breakdown.transactionFees, color: "fees" },
    { key: "gst", label: "GST on PayPal fees", amount: result.breakdown.gst, color: "gst" },
    { key: "fxSpread", label: "FX spread", amount: result.breakdown.fxSpread, color: "spread" },
  ] : [];
  const breakdownMatches = result && Math.abs(result.breakdownDifference) <= 1;
  const actual = actualInput.trim() === "" ? null : Number(actualInput);
  const validActual = actual === null || (Number.isFinite(actual) && actual >= 0);
  const realityCheck = result && actual !== null && validActual
    ? {
        lossPercent: result.midMarketValue > 0 ? ((result.midMarketValue - actual) / result.midMarketValue) * 100 : 0,
        impliedSpread: result.netForeign * result.midRate > 0 ? 1 - actual / (result.netForeign * result.midRate) : 0,
        creditedDifference: actual - result.inrCredited,
        creditedDifferencePercent: result.inrCredited > 0 ? ((actual - result.inrCredited) / result.inrCredited) * 100 : 0,
      }
    : null;
  const scenarios = result
    ? scenarioGrossAmounts.map((scenarioGross) => ({
        gross: scenarioGross,
        result: calculatePaypalLeak({
          gross: scenarioGross,
          currency,
          midRate,
          includeGst,
          conversionMode,
        }),
      }))
    : [];
  const currentDifferencePerUnit = result ? result.midRate - result.paypalRate : 0;
  const updateCurrency = (nextCurrency) => {
    setCurrency(nextCurrency);
    if (nextCurrency === "INR") setRateInput("1");
    else if (currency === "INR") setRateInput("90");
  };

  return (
    <div className="paypal-leak-calculator">
      <Panel title="Estimate your PayPal fee and INR conversion" subtitle="An editable model for an Indian freelancer receiving an international commercial payment.">
        <div className="leak-input-grid">
          <label className="field-label">Gross amount received
            <input type="number" min="0.01" step="any" value={grossInput} onChange={(event) => setGrossInput(event.target.value)} />
          </label>
          <label className="field-label">Currency received
            <select value={currency} onChange={(event) => updateCurrency(event.target.value)}>
              {currencies.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label className="field-label">Mid-market / base rate (estimate)
            <input type="number" min="0.000001" step="any" value={rateInput} disabled={currency === "INR"} onChange={(event) => setRateInput(event.target.value)} />
            {currency === "INR" && <small>INR receipts have a fixed 1:1 rate.</small>}
          </label>
          <label className="field-label">Conversion type
            <select value={conversionMode} disabled={currency === "INR"} onChange={(event) => setConversionMode(event.target.value)}>
              <option value="receivedPayment">Converting payments received ({formatPercent(PAYPAL_LEAK_CONFIG.conversionSpread.receivedPayment * 100)})</option>
              <option value="otherConversion">Other conversion ({formatPercent(PAYPAL_LEAK_CONFIG.conversionSpread.otherConversion * 100)})</option>
            </select>
          </label>
          <label className="field-label">Actual INR credited in my bank (optional)
            <input type="number" min="0" step="any" value={actualInput} onChange={(event) => setActualInput(event.target.value)} placeholder="Enter bank credit to compare" />
          </label>
          <label className="leak-gst-toggle">
            <input type="checkbox" checked={includeGst} onChange={(event) => setIncludeGst(event.target.checked)} />
            <span>Include {formatPercent(PAYPAL_LEAK_CONFIG.gstRate * 100)} GST on PayPal fees</span>
          </label>
        </div>
        {!validInputs && <p className="leak-input-error" role="alert">Enter a gross amount and mid-market rate greater than zero.</p>}
        {!validActual && <p className="leak-input-error" role="alert">Actual INR credited must be zero or a positive amount.</p>}
        <p className="leak-estimate-note"><Info size={14} /> Starting values are editable examples, not live rates. No mid-market rate source is configured here; the existing PayPal quote endpoint returns PayPal quotes, not a mid-market rate.</p>
      </Panel>

      {result && (
        <>
          <section className="leak-summary-grid" aria-label="Estimated payment summary">
            <article className="leak-summary-card"><span>Client paid</span><strong>{formatForeign(result.gross, currency)}</strong><small>Input used in Steps 1 and 8</small></article>
            <article className="leak-summary-card received"><span>You receive in bank</span><strong>{formatRupees(result.inrCredited)}</strong><small>Step 7 · modeled bank credit</small></article>
            <article className="leak-summary-card lost"><span>Total money leaked</span><strong>{formatRupees(result.totalLossINR)}</strong><small>{formatPercent(result.totalLossPercent)} of mid-market value</small></article>
            <article className="leak-summary-card"><span>Effective rate you got</span><strong>{formatRate(result.effectiveRate)} / {currency}</strong><small>Step 7 ÷ gross · base estimate: {formatRate(result.midRate)} / {currency}</small></article>
          </section>

          <Panel title="Step-by-step calculation" subtitle="Each displayed value follows the numbered calculation shown here; fees are applied before conversion.">
            <div className="table-scroll">
              <table className="data-table leak-steps-table">
                <thead><tr><th>Step</th><th>What PayPal does</th><th>Formula</th><th>Amount (foreign)</th><th>Amount (₹)</th></tr></thead>
                <tbody>{steps.map((step) => <tr key={step.step}><td><span className="leak-step-number">{step.step}</span></td><td>{step.action}</td><td><code>{step.formula}</code></td><td>{step.foreign}</td><td>{step.inr}</td></tr>)}</tbody>
              </table>
            </div>
          </Panel>

          <div className="leak-analysis-grid">
            <Panel title="Leak breakdown" subtitle="Components are calculated in INR and reconcile to total modeled loss.">
              <div className="leak-stacked-bar" role="img" aria-label={`Leak breakdown: transaction fees ${formatPercent(result.totalLossINR ? result.breakdown.transactionFees / result.totalLossINR * 100 : 0)}, GST ${formatPercent(result.totalLossINR ? result.breakdown.gst / result.totalLossINR * 100 : 0)}, FX spread ${formatPercent(result.totalLossINR ? result.breakdown.fxSpread / result.totalLossINR * 100 : 0)}`}>
                {breakdownItems.map((item) => <span key={item.key} className={item.color} style={{ width: `${result.totalLossINR > 0 ? item.amount / result.totalLossINR * 100 : 0}%` }} />)}
              </div>
              <div className="leak-breakdown-table">
                {breakdownItems.map((item) => {
                  const percentage = result.totalLossINR > 0 ? item.amount / result.totalLossINR * 100 : 0;
                  return <div key={item.key} className={`leak-breakdown-row ${item.color}`}><span><i />{item.label}</span><b>{formatRupees(item.amount)}</b><small>{formatPercent(percentage)}</small>{item.key === "fxSpread" && <em>Hidden cost, not shown as a fee line on PayPal.</em>}</div>;
                })}
              </div>
              <p className={`leak-verification ${breakdownMatches ? "matched" : "warning"}`} role="status">{breakdownMatches ? <Check size={15} /> : <AlertTriangle size={15} />}{breakdownMatches ? "Breakdown sum = total loss ✓" : "Warning: breakdown differs from total loss by more than ₹1."}</p>
            </Panel>

            <Panel title="Rate comparison" subtitle="The comparison uses your editable mid-market estimate.">
              <div className="leak-rate-comparison">
                <div><span>Mid-market (base) rate</span><b>{formatRate(result.midRate)} / {currency}</b></div>
                <div><span>PayPal's modeled transaction rate</span><b>{formatRate(result.paypalRate)} / {currency}</b></div>
                <div><span>Difference per unit</span><b className="leak-amount">{formatRate(currentDifferencePerUnit)} / {currency}</b></div>
                <div><span>Difference</span><b className="leak-amount">{formatPercent(result.midRate ? currentDifferencePerUnit / result.midRate * 100 : 0)}</b></div>
                <div><span>Applied FX spread</span><b>{currency === "INR" ? "₹0.00 · no conversion" : formatPercent(result.spread * 100)}</b></div>
              </div>
              <p className="leak-disclaimer">Estimate: PayPal publishes “{formatPercent(result.spread * 100)} above the base rate”, modeled here as base × (1 − {formatPercent(result.spread * 100)}). PayPal's actual wholesale base rate can differ slightly from a mid-market rate.</p>
            </Panel>
          </div>

          {realityCheck && (
            <Panel title="Reality check" subtitle="Compare the model with the amount actually credited to your bank.">
              <div className="leak-reality-grid">
                <div><span>Actual INR credited</span><b className="leak-received">{formatRupees(actual)}</b></div>
                <div><span>Actual loss vs mid-market</span><b className="leak-amount">{formatRupees(result.midMarketValue - actual)} · {formatPercent(realityCheck.lossPercent)}</b></div>
                <div><span>Modeled vs actual credit difference</span><b className={realityCheck.creditedDifference >= 0 ? "leak-received" : "leak-amount"}>{realityCheck.creditedDifference >= 0 ? "+" : "−"}{formatRupees(Math.abs(realityCheck.creditedDifference))} · {formatPercent(Math.abs(realityCheck.creditedDifferencePercent))}</b></div>
                <div><span>Implied real conversion spread</span><b>{formatPercent(realityCheck.impliedSpread * 100)}</b></div>
              </div>
              <p className="leak-reality-message">Your real spread was {formatPercent(realityCheck.impliedSpread * 100)} vs the documented {formatPercent(PAYPAL_LEAK_CONFIG.conversionSpread.receivedPayment * 100)}.</p>
              <small className="leak-disclaimer">Actual bank credit may include timing, bank-side adjustments, or other factors not represented in this estimate.</small>
            </Panel>
          )}

          <details className="leak-explainer" open>
            <summary>How PayPal converts</summary>
            <ol>
              <li>Fees are charged in the foreign currency <b>before conversion</b>.</li>
              <li>PayPal's base rate comes from the wholesale currency market on the conversion day or the prior business day. The rate entered above is a mid-market estimate and may differ slightly.</li>
              <li>PayPal adds its conversion fee on top of the base rate: {formatPercent(PAYPAL_LEAK_CONFIG.conversionSpread.receivedPayment * 100)} for converting payments received, {formatPercent(PAYPAL_LEAK_CONFIG.conversionSpread.otherConversion * 100)} for other conversions. The rate is modeled here as base × (1 − spread).</li>
              <li>Indian PayPal accounts cannot hold foreign currency, so every payment is auto-converted to INR and transferred to the linked bank account daily. <span className="third-party-label">Reported by third-party sources, not on PayPal's fee page.</span></li>
              <li>The bank transfer has no withdrawal fee when no conversion is involved. <span className="third-party-label">Reported by third-party sources, not on PayPal's fee page.</span></li>
              <li>PayPal provides a free weekly digital FIRA (inward remittance advice). <span className="third-party-label">Reported by third-party sources, not on PayPal's fee page.</span></li>
            </ol>
            <p className="leak-disclaimer">GST inclusion and Indian auto-conversion details are reported by third-party sources, not on PayPal's fee page. Confirm your applicable treatment with current PayPal statements and a qualified tax professional.</p>
          </details>

          <Panel title="Scenarios" subtitle={`Same inputs and calculation method for ${currency} ${currency === "INR" ? "payments" : "payments converted to INR"}.`}>
            <div className="table-scroll">
              <table className="data-table leak-scenario-table">
                <thead><tr><th>Gross ({currency})</th><th>Fees + GST ({currency})</th><th>Estimated bank credit</th><th>Total leak</th><th>Leak %</th><th>Step trace</th></tr></thead>
                <tbody>{scenarios.map(({ gross: scenarioGross, result: scenario }) => <tr key={scenarioGross}><td>{formatForeign(scenarioGross, currency)}</td><td>{formatForeign(scenario.totalFee + scenario.gst, currency)}</td><td className="leak-received">{formatRupees(scenario.inrCredited)}</td><td className="leak-amount">{formatRupees(scenario.totalLossINR)}</td><td>{formatPercent(scenario.totalLossPercent)}</td><td>Steps 1–10</td></tr>)}</tbody>
              </table>
            </div>
            <p className="leak-disclaimer">The percentage loss varies with the fixed fee and selected currency; it is not guaranteed to stay near a single percentage.</p>
          </Panel>

          <Panel title="Worked example · USD 1,000 at ₹90.00" subtitle="All amounts below are calculated by the same engine and configured assumptions.">
            <div className="leak-worked-example">
              <div><span>Transaction fee</span><b>{formatForeign(workedExample.totalFee, "USD")}</b></div>
              <div><span>GST on fees</span><b>{formatForeign(workedExample.gst, "USD")}</b></div>
              <div><span>Net after fees</span><b>{formatForeign(workedExample.netForeign, "USD")}</b></div>
              <div><span>Modeled PayPal rate</span><b>{formatRate(workedExample.paypalRate)} / USD</b></div>
              <div><span>Estimated bank credit</span><b className="leak-received">{formatRupees(workedExample.inrCredited)}</b></div>
              <div><span>Total modeled loss</span><b className="leak-amount">{formatRupees(workedExample.totalLossINR)} · {formatPercent(workedExample.totalLossPercent)}</b></div>
            </div>
          </Panel>

          <footer className="leak-sources">
            <b>Sources and assumptions</b>
            <a href="https://www.paypal.com/in/business/paypal-business-fees" target="_blank" rel="noreferrer">PayPal India Business Fees</a>
            <a href="https://www.paypal.com/in/webapps/mpp/ua/useragreement-full" target="_blank" rel="noreferrer">PayPal India User Agreement</a>
            <p>PayPal India fee page last updated 28 March 2024. Verify current rates. GST and auto-conversion details are reported by third-party sources, not on PayPal's fee page.</p>
          </footer>
        </>
      )}
    </div>
  );
}
