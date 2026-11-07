import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, Clock3, Info, Sparkles, TriangleAlert } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { money } from "../data/demoData.js";
import { calculateLeak } from "../utils/calculations.js";

export default function LeakAnalysis() {
  const { transactions } = useAppData();
  const [selectedId, setSelectedId] = useState(transactions[0]?.id || "");
  const [currency, setCurrency] = useState("INR");
  const [dateRange, setDateRange] = useState("Last 30 days");
  const filteredTransactions = useMemo(() => {
    if (dateRange === "All demo data") return transactions;
    const days = dateRange === "Last 30 days" ? 30 : 90;
    const latestDate = new Date(`${transactions[0]?.date || new Date().toISOString().slice(0, 10)}T12:00:00`);
    const cutoff = new Date(latestDate);
    cutoff.setDate(cutoff.getDate() - days);
    return transactions.filter((item) => new Date(`${item.date}T12:00:00`) >= cutoff);
  }, [transactions, dateRange]);
  const effectiveId = filteredTransactions.some((item) => item.id === selectedId) ? selectedId : filteredTransactions[0]?.id;
  const transaction = filteredTransactions.find((item) => item.id === effectiveId);
  const amounts = useMemo(() => transaction ? calculateLeak(transaction, currency) : null, [transaction, currency]);
  if (!transaction || !amounts) return <div className="empty-state">No demo transactions are available.</div>;
  const formatOriginal = (value) => money(value, transaction.currency);
  const formatReceived = (value) => money(value, currency);
  const breakdown = [
    { label: "Original payment amount", amount: transaction.gross, barValue: transaction.gross * amounts.actualRate, note: `Paid in ${transaction.currency}`, type: "positive" },
    { label: "PayPal transaction fee", amount: -transaction.fee, barValue: transaction.fee * amounts.actualRate, note: "Demo estimate · not verified", type: "fee" },
    { label: "Currency conversion loss", amount: -amounts.conversionLoss, barValue: amounts.conversionLoss, note: `Shown in ${currency} report currency`, type: "loss", outputCurrency: true },
    { label: "Other known fees", amount: -transaction.otherFees, barValue: transaction.otherFees * amounts.actualRate, note: transaction.otherFees ? "Demo estimate" : "No additional fee reported", type: "fee" },
    { label: "Estimated final received", amount: transaction.net, barValue: amounts.actual, note: "Sample transaction value", type: "total" },
  ];

  return (
    <div className="page-enter">
      <PageHeader eyebrow="ANALYTICS / TRANSACTIONS" title="Money Leak Analysis" description="Understand exactly where an international payment can lose value." />
      <div className="analysis-controls">
        <label className="field-label">Selected transaction<select value={effectiveId || ""} onChange={(event) => setSelectedId(event.target.value)}>{filteredTransactions.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.client} · {money(item.gross, item.currency)}</option>)}</select></label>
        <label className="field-label">Date range<select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option>Last 30 days</option><option>Last 90 days</option><option>All demo data</option></select></label>
        <label className="field-label">Report currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{["INR", "USD", "EUR", "GBP"].map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="selected-transaction-card">
        <div className="selected-transaction-title"><span className="transaction-avatar">{transaction.client.slice(0, 1)}</span><div><span>DEMO TRANSACTION · {transaction.id}</span><b>{transaction.client}</b><small>{new Date(`${transaction.date}T12:00:00`).toLocaleDateString("en-US", { dateStyle: "long" })} · {transaction.currency} → {currency}</small></div></div>
        <div className="selected-amount"><small>Gross transaction</small><b>{formatOriginal(transaction.gross)}</b></div>
        <div className="selected-amount"><small>Transaction fee <i className="demo-estimate">ESTIMATE</i></small><b className="loss-text">−{formatOriginal(transaction.fee)}</b></div>
        <div className="selected-amount"><small>Net transaction</small><b>{formatOriginal(transaction.net)}</b></div>
      </div>
      <div className="analysis-grid">
        <Panel title="Where your money went" subtitle="Illustrative breakdown · source currency unless noted">
          <div className="waterfall-list">
            {breakdown.map((item, index) => <div className={`waterfall-row ${item.type}`} key={item.label}><span className="waterfall-step">{index + 1}</span><span className="waterfall-label"><b>{item.label}</b><small>{item.note}</small></span><div className="waterfall-track"><span style={{ width: `${Math.min(100, Math.max(2, item.barValue / (transaction.gross * amounts.actualRate) * 100))}%` }} /></div><b className="waterfall-amount">{item.amount < 0 ? "−" : ""}{item.outputCurrency ? formatReceived(Math.abs(item.amount)) : formatOriginal(Math.abs(item.amount))}</b></div>)}
          </div>
          <div className="analysis-total"><span><ArrowDownRight size={16} /> Total identified loss ({currency} report currency)</span><b>{formatReceived(amounts.totalLoss)}</b></div>
        </Panel>
        <Panel title="AI explanation" subtitle="Grounded in the selected demo transaction">
          <div className="ai-explanation"><div className="ai-bubble-icon"><Sparkles size={17} /></div><div><p>Your demo payment shows a transaction fee of <b>{formatOriginal(transaction.fee)}</b>. Compared with the selected reference rate, the estimated conversion difference is <b>{formatReceived(amounts.conversionLoss)}</b>. {transaction.otherFees ? `Other known demo costs add ${formatOriginal(transaction.otherFees)}.` : "No additional fees are included in this sample."}</p><small>Demo data only · Not verified PayPal or bank information</small></div></div>
          <div className="savings-callout"><span className="savings-icon"><ArrowRight size={17} /></span><div><b>Explore a lower-cost route</b><p>Compare simulated alternatives and their assumptions before making any decision.</p><a href="/route-optimizer">Open route optimizer <ArrowRight size={13} /></a></div></div>
        </Panel>
      </div>
      <Panel title="Calculation details" subtitle="All conversion and reference values below are illustrative demo data." className="calculation-panel">
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Gross amount</th><th>Transaction fee</th><th>Fee currency</th><th>Actual rate</th><th>Reference rate</th><th>Estimated converted</th><th>Expected converted</th><th>Identified loss</th></tr></thead><tbody><tr><td>{formatOriginal(transaction.gross)}</td><td className="loss-text">{formatOriginal(transaction.fee)}</td><td>{transaction.currency}</td><td>{amounts.actualRate.toFixed(4)} {currency}/{transaction.currency}</td><td>{amounts.expectedRate.toFixed(4)} {currency}/{transaction.currency}</td><td>{formatReceived(amounts.actual)}</td><td>{formatReceived(amounts.expected)}</td><td className="loss-text"><b>{formatReceived(amounts.totalLoss)}</b></td></tr></tbody></table></div>
        <div className="method-note"><Info size={15} /><span><b>Method:</b> eligible amount = gross − transaction fee. Expected converted = eligible amount × reference rate. Conversion loss = max(0, expected − estimated actual). The transaction fee is counted once and is not subtracted again from conversion loss.</span></div>
        <div className="source-note"><Clock3 size={14} /> Reference: {transaction.referenceSource} · {transaction.referenceTime} <span>· Range selected: {dateRange}</span></div>
      </Panel>
      <div className="warning-note"><TriangleAlert size={17} /><span><b>Estimated, not verified.</b> Fees, exchange rates, and converted amounts shown here are fictional examples. Actual PayPal fees, bank charges, and reference-rate source data are unavailable in this demo.</span></div>
    </div>
  );
}
