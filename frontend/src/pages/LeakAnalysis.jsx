<<<<<<< HEAD
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BadgeCheck, CircleHelp, ExternalLink, Info, RefreshCw, Sparkles } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import StatCard from "../components/StatCard.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { fetchTransactionAiAnalysis, refreshPaypalTransaction } from "../services/transactionService.js";
import { money } from "../utils/formatters.js";

function displayMoney(value, currency) {
  if (value == null || !currency) return "Unavailable";
  try {
    return money(value, currency);
  } catch {
    return `${value} ${currency}`;
  }
}

function statusLabel(status) {
  return ({
    verified_by_paypal: "Verified by PayPal",
    reported_by_paypal: "Reported by PayPal",
    calculated: "Calculated",
    estimated: "Estimated",
    recorded: "Recorded",
    unavailable: "Unavailable",
    incomplete: "Incomplete",
    INCOMPLETE: "Incomplete",
    MATCH: "Match",
    MISMATCH: "Mismatch",
    NOT_AVAILABLE: "Not available",
    NOT_APPLICABLE: "Not applicable",
    PARTIALLY_RECONCILED: "Partially reconciled",
  })[status] || status || "Unavailable";
}

function ValueBadge({ status }) {
  const tone = status === "verified_by_paypal" ? "verified"
    : status === "reported_by_paypal" ? "verified"
    : status === "calculated" ? "calculated"
      : status === "estimated" ? "estimated"
        : status === "recorded" ? "recorded"
        : "unavailable";
  return <span className={`analysis-badge ${tone}`}>{statusLabel(status)}</span>;
}

function AnalysisValue({ value, currency }) {
  return value == null ? "Unavailable" : displayMoney(value, currency);
}

function comparisonLabel(status) {
  return statusLabel(status) || "Pending";
}

function ComparisonBadge({ status }) {
  const tone = String(status || "PENDING").toLowerCase().replaceAll("_", "-");
  return <span className={`verification-badge ${tone}`}>{comparisonLabel(status)}</span>;
}

export default function LeakAnalysis() {
  const { transactions } = useAppData();
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get("transaction") || "";
  const [selectedId, setSelectedId] = useState(requestedId);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState("analysis");
  const [regenerateCount, setRegenerateCount] = useState(0);
  const refreshControllerRef = useRef(null);
  const effectiveId = selectedId || requestedId || transactions[0]?.id || "";
  const currentAnalysis = analysis?.transactionId === effectiveId ? analysis : null;
  const selectedTransaction = transactions.find((transaction) => transaction.id === effectiveId);

  useEffect(() => {
    setSelectedId(requestedId);
  }, [requestedId]);

  useEffect(() => {
    if (!effectiveId) {
      setAnalysis(null);
      setError("");
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    setAnalysis(null);
    setLoading(true);
    setError("");
    fetchTransactionAiAnalysis(effectiveId, {
      regenerate: regenerateCount > 0,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setAnalysis(result);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setError(requestError.response?.data?.error?.message || "Could not generate the transaction analysis.");
          setErrorAction("analysis");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      refreshControllerRef.current?.abort();
      refreshControllerRef.current = null;
      setRefreshing(false);
    };
  }, [effectiveId, regenerateCount]);

  const retry = () => setRegenerateCount((count) => count + 1);
  const refreshPaypalData = async () => {
    if (!effectiveId || refreshing) return;
    refreshControllerRef.current?.abort();
    const controller = new AbortController();
    refreshControllerRef.current = controller;
    setRefreshing(true);
    setLoading(true);
    setAnalysis(null);
    setError("");
    setErrorAction("refresh");
    let paypalRefreshCompleted = false;
    try {
      await refreshPaypalTransaction(effectiveId, controller.signal);
      paypalRefreshCompleted = true;
      const updatedAnalysis = await fetchTransactionAiAnalysis(effectiveId, {
        regenerate: true,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setAnalysis(updatedAnalysis);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        const detail = requestError.response?.data?.error?.message
          || (paypalRefreshCompleted ? "Could not update the explanation." : "Could not refresh this transaction from PayPal.");
        setError(paypalRefreshCompleted
          ? `PayPal data was refreshed, but the analysis could not be updated. ${detail}`
          : detail);
        setErrorAction(paypalRefreshCompleted ? "analysis" : "refresh");
      }
    } finally {
      if (refreshControllerRef.current === controller) {
        refreshControllerRef.current = null;
        setRefreshing(false);
        setLoading(false);
      }
    }
  };
  const overview = currentAnalysis?.overview;

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="ANALYTICS / TRANSACTIONS"
        title="Money Leak Analysis"
        description="Understand confirmed PayPal deductions and see which conversion or settlement costs still need verification."
        action={effectiveId && <div className="analysis-actions">
          <button className="button secondary" onClick={refreshPaypalData} disabled={loading || refreshing}><RefreshCw size={15} /> {refreshing ? "Refreshing PayPal…" : "Refresh PayPal Transaction Data"}</button>
          <button className="button secondary" onClick={retry} disabled={loading}><Sparkles size={15} /> Regenerate AI Explanation</button>
        </div>}
      />
      {transactions.length > 0 && (
        <div className="analysis-controls">
          <label className="field-label">Selected transaction
            <select value={effectiveId} onChange={(event) => { setSelectedId(event.target.value); setRegenerateCount(0); }}>
              {requestedId && !transactions.some((item) => item.id === requestedId) && <option value={requestedId}>{requestedId} · selected transaction</option>}
              {transactions.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.client || "Unknown payer"} · {item.currency} {item.gross}</option>)}
            </select>
          </label>
          <div className="analysis-selected-meta">
            <span>{selectedTransaction?.client || "Payer not available"}</span>
            <b>{selectedTransaction?.date || "Date unavailable"}</b>
          </div>
          {effectiveId && <Link className="button secondary small-button" to={`/transactions?transaction=${encodeURIComponent(effectiveId)}`}><ExternalLink size={14} /> View Transaction Details</Link>}
        </div>
      )}

      {loading && <div className="page-loading"><span className="spinner" /> Calculating verified amounts and generating transaction-specific insights…</div>}
      {error && <div className="panel analysis-error" role="alert"><b>Analysis unavailable</b><span>{error}</span><button className="button secondary" onClick={errorAction === "refresh" ? refreshPaypalData : retry}><RefreshCw size={14} /> {errorAction === "refresh" ? "Retry PayPal refresh" : "Retry analysis"}</button></div>}
      {!effectiveId && !loading && <div className="panel empty-state"><b>No synced transactions</b><span>Sync PayPal transactions before generating a financial explanation.</span></div>}

      {currentAnalysis && !loading && (
        <>
          <section className="stats-grid four analysis-stat-grid" aria-label="Transaction overview">
            <StatCard label="Gross transaction amount" value={displayMoney(overview.grossAmount.value, overview.grossAmount.currency)} note="Reported by PayPal Transaction Search" tone="purple" icon={BadgeCheck} />
            <StatCard label="Confirmed PayPal fee" value={displayMoney(overview.fee.value, overview.fee.currency)} note={overview.feePercentageOfGross == null ? "Fee percentage unavailable" : `${overview.feePercentageOfGross}% of gross`} tone="red" icon={Info} />
            <StatCard label="PayPal reported net" value={overview.reportedNet ? displayMoney(overview.reportedNet.value, overview.reportedNet.currency) : "Unavailable"} note={`Verification: ${overview.netVerificationStatus}`} tone={overview.netVerificationStatus === "MISMATCH" ? "red" : "green"} icon={BadgeCheck} />
            <StatCard label="PayLeak calculated net" value={overview.calculatedNet ? displayMoney(overview.calculatedNet.value, overview.calculatedNet.currency_code) : "Unavailable"} note="Calculated from same-currency gross and fee" tone="purple" icon={Info} />
          </section>

          <div className="analysis-grid">
            <Panel title="Transaction overview" subtitle={`${currentAnalysis.transaction.transactionType} · ${currentAnalysis.transaction.status} · ${new Date(currentAnalysis.transaction.date).toLocaleString()}`}>
              <div className="analysis-fact-list">
                <div><span>Payer</span><b>{currentAnalysis.transaction.payer || "Not available from PayPal data"}</b><ValueBadge status={currentAnalysis.transaction.payer ? "verified_by_paypal" : "unavailable"} /></div>
                <div><span>Gross transaction amount</span><b>{displayMoney(overview.grossAmount.value, overview.grossAmount.currency)}</b><ValueBadge status="verified_by_paypal" /></div>
                <div><span>PayPal transaction fee</span><b><AnalysisValue value={overview.fee.value} currency={overview.fee.currency} />{overview.feePercentageOfGross != null && ` · ${overview.feePercentageOfGross}%`}</b><ValueBadge status={overview.fee.source === "PayPal Transaction Search" ? "verified_by_paypal" : "unavailable"} /></div>
                <div><span>PayPal reported net</span><b><AnalysisValue value={overview.reportedNet?.value} currency={overview.reportedNet?.currency} /></b><ValueBadge status={overview.reportedNet ? "verified_by_paypal" : "unavailable"} /></div>
                <div><span>PayLeak calculated net</span><b><AnalysisValue value={overview.calculatedNet?.value} currency={overview.calculatedNet?.currency_code} /></b><ValueBadge status={overview.calculatedNet ? "calculated" : "unavailable"} /></div>
                <div><span>Currency conversion</span><b>{overview.conversion.exchangeRate ? `${overview.conversion.exchangeRate} (${overview.conversion.rateDirection || "direction unavailable"})` : "Rate unavailable"}<small className="analysis-source-note">Source: {overview.conversion.source || "unavailable"}{overview.conversion.retrievedAt ? ` · recorded ${new Date(overview.conversion.retrievedAt).toLocaleString()}` : ""}</small></b><ValueBadge status={overview.conversion.status} /></div>
                <div><span>Recorded converted amount</span><b><AnalysisValue value={overview.conversion.targetAmount} currency={overview.conversion.targetCurrency} /></b><ValueBadge status={overview.conversion.status} /></div>
                <div><span>Withdrawal fee</span><b><AnalysisValue value={overview.withdrawal.feeAmount} currency={overview.withdrawal.feeCurrency} /></b><ValueBadge status={overview.withdrawal.status} /></div>
                <div><span>PayPal final payout</span><b><AnalysisValue value={overview.finalPayout?.value} currency={overview.finalPayout?.currency} /></b><ValueBadge status={overview.finalPayout ? "verified_by_paypal" : "unavailable"} /></div>
              </div>
            </Panel>

            <Panel title="AI transaction explanation" subtitle="Grounded in this transaction's stored PayPal data" className="ai-transaction-panel">
              <div className="ai-transaction-heading"><span className="ai-bubble-icon"><Sparkles size={17} /></span><b>Transaction-specific financial explanation</b></div>
              <p className="ai-transaction-copy">{currentAnalysis.ai.explanation}</p>
              <small>Amounts and percentages shown in the overview are calculated by PayLeak from verified records. AI does not determine financial values.</small>
            </Panel>
          </div>

          <Panel title="PayPal vs PayLeak Calculation Verification" subtitle="PayPal-reported source values compared with independent PayLeak calculations">
            <div className="table-scroll">
              <table className="data-table verification-table">
                <thead><tr><th>Financial value</th><th>PayPal reported</th><th>PayLeak calculated / stored</th><th>Difference (PayPal − PayLeak)</th><th>Result</th></tr></thead>
                <tbody>
                  <tr><td>Gross amount</td><td>{displayMoney(currentAnalysis.reportedValues.gross.amount, currentAnalysis.reportedValues.gross.currency)}</td><td>{displayMoney(currentAnalysis.calculatedValues.gross.amount, currentAnalysis.calculatedValues.gross.currency)}</td><td>—</td><td><ComparisonBadge status={currentAnalysis.verification.gross.status} /></td></tr>
                  <tr><td>Transaction fee (stored input)</td><td>{displayMoney(currentAnalysis.reportedValues.fee.amount, currentAnalysis.reportedValues.fee.currency)}</td><td>{currentAnalysis.calculatedValues.feeInput ? displayMoney(currentAnalysis.calculatedValues.feeInput.amount, currentAnalysis.calculatedValues.feeInput.currency) : "Unavailable"}</td><td>—</td><td><ComparisonBadge status={currentAnalysis.verification.fee.status} /></td></tr>
                  <tr><td>Net amount</td><td>{displayMoney(currentAnalysis.reportedValues.net?.amount, currentAnalysis.reportedValues.net?.currency)}</td><td>{displayMoney(currentAnalysis.calculatedValues.net?.value, currentAnalysis.calculatedValues.net?.currency_code)}</td><td>{displayMoney(currentAnalysis.calculatedValues.netDifference?.amount, currentAnalysis.calculatedValues.netDifference?.currency)}</td><td><ComparisonBadge status={currentAnalysis.verification.net.status} /></td></tr>
                  <tr><td>Exchange rate</td><td>{overview.conversion.exchangeRate ?? "Not provided"}</td><td>Not calculated</td><td>—</td><td><ComparisonBadge status={currentAnalysis.verification.exchangeRate.status} /></td></tr>
                  <tr><td>Final payout</td><td>{displayMoney(currentAnalysis.reportedValues.finalPayout?.amount, currentAnalysis.reportedValues.finalPayout?.currency)}</td><td>Not calculated</td><td>—</td><td><ComparisonBadge status={currentAnalysis.verification.finalPayout.status} /></td></tr>
                </tbody>
              </table>
            </div>
            {currentAnalysis.verification.net.explanation && <p className="analysis-footnote"><Info size={14} /> {currentAnalysis.verification.net.explanation}</p>}
          </Panel>

          <div className="analysis-grid">
            <Panel title="Where did your money go?" subtitle="Only supported stages are calculated">
              <div className="money-flow">
                {currentAnalysis.moneyFlow.map((stage, index) => (
                  <div className="money-flow-step" key={stage.stage}>
                    <div className="money-flow-card">
                      <span>{stage.stage}</span>
                      <b>{displayMoney(stage.amount, stage.currency)}</b>
                      <ValueBadge status={stage.status} />
                    </div>
                    {index < currentAnalysis.moneyFlow.length - 1 && <span className="money-flow-arrow" aria-hidden="true">→</span>}
                  </div>
                ))}
              </div>
              <p className="analysis-footnote"><Info size={14} /> A recorded PayPal final amount is not proof of the amount settled into a bank account.</p>
            </Panel>
            <Panel title="Confirmed PayPal deductions" subtitle="No missing value is treated as zero">
              <div className="loss-summary">
                <div><span>Confirmed PayPal fee</span><b>{displayMoney(currentAnalysis.confirmedLoss.amount, currentAnalysis.confirmedLoss.currency)}</b><ValueBadge status={currentAnalysis.confirmedLoss.status} /></div>
                <div><span>Reconciliation</span><b>{statusLabel(currentAnalysis.reconciliation.status)}</b><small>{currentAnalysis.reconciliation.explanation}</small></div>
              </div>
              <ul className="unknown-costs">{currentAnalysis.unavailableCosts.map((item) => <li key={item}><CircleHelp size={14} /> {item}</li>)}</ul>
            </Panel>
          </div>

          <div className="analysis-grid">
            <Panel title="Calculation discrepancy analysis" subtitle="Investigate data differences without forcing a match">
              <div className="discrepancy-callout">
                <ComparisonBadge status={currentAnalysis.verification.net.status} />
                <p>{currentAnalysis.verification.net.explanation}</p>
                {currentAnalysis.verification.net.difference && <b>Difference: {displayMoney(currentAnalysis.verification.net.difference, currentAnalysis.reportedValues.net?.currency || currentAnalysis.calculatedValues.net?.currency_code)}</b>}
              </div>
              {currentAnalysis.verification.net.reasons.length > 0
                ? <ul className="analysis-bullet-list">{currentAnalysis.verification.net.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul>
                : <p className="analysis-footnote">No net discrepancy was reported by the available source fields.</p>}
              <h3 className="analysis-subheading">Financial reconciliation status</h3>
              <ComparisonBadge status={currentAnalysis.reconciliation.status === "PARTIALLY_RECONCILED" ? (currentAnalysis.reconciliation.complete ? "MATCH" : "PENDING") : currentAnalysis.reconciliation.status} />
              <p className="analysis-footnote">{currentAnalysis.reconciliation.explanation}</p>
            </Panel>
            <Panel title="PayPal reported financial values" subtitle="Source values remain separate from PayLeak calculations">
              <div className="deduction-list">
                {currentAnalysis.deductions.map((item) => (
                  <details key={item.type} className="deduction-item">
                    <summary><span>{item.type}</span><b>{displayMoney(item.amount, item.currency)}</b><ValueBadge status={item.status} /></summary>
                    <div><p>{item.percentageOfOriginal == null ? "Percentage of original payment unavailable." : `${item.percentageOfOriginal}% of the original payment.`}</p><small>Source: {item.source}</small></div>
                  </details>
                ))}
              </div>
              <p className="analysis-footnote">Last retrieved from PayPal {new Date(overview.retrievedAt).toLocaleString()} · Status: {statusLabel(overview.financialDataStatus)}</p>
            </Panel>
            <Panel title="AI financial insights" subtitle="Interpretation based on this transaction">
              <ul className="analysis-bullet-list">{currentAnalysis.ai.insights.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
              <h3 className="analysis-subheading">Recommended next actions</h3>
              <ul className="analysis-bullet-list recommendations">{currentAnalysis.ai.recommendations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
=======
export default function LeakAnalysis() {
  return <main><h1>Leak analysis</h1><p>Payment fee analysis will appear here.</p></main>;
>>>>>>> dcb877a2283b466bc7b3821e56fd18eed33a0452
}
