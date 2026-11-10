import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, ArrowRight, CircleDollarSign, FilePlus2, RefreshCw, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import Panel from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { getInvoiceTotals, money } from "../utils/formatters.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getDefaultPaypalSyncRange } from "../services/transactionService.js";

function currencySummary(items, valueKey) {
  if (!items.length) return "No records";
  return items.map((item) => `${item.currency} ${item[valueKey]}`).join(" · ");
}

export default function Dashboard() {
  const { transactions, invoices, analytics, syncTransactions } = useAppData();
  const { paypal, refreshPaypalAccount } = useAuth();
  const navigate = useNavigate();
  const [currency, setCurrency] = useState("");
  const [syncing, setSyncing] = useState(false);
  const currencies = analytics?.currencies ?? [];
  const selectedCurrency = currency || currencies[0]?.currency || "";
  const monthlyCounts = useMemo(() => {
    const months = new Map();
    transactions.filter((item) => !selectedCurrency || item.currency === selectedCurrency).forEach((item) => {
      const date = new Date(`${item.date}T12:00:00`);
      const month = date.toLocaleString("en-US", { month: "short", year: "2-digit" });
      months.set(month, (months.get(month) || 0) + 1);
    });
    return [...months].map(([month, count]) => ({ month, count }));
  }, [transactions, selectedCurrency]);
  const invoiceTotals = getInvoiceTotals(invoices);
  const unavailableConversions = analytics?.conversions?.unavailableCount ?? 0;
  const actualFees = analytics?.feesByCurrency ?? [];

  const syncPaypal = async () => {
    if (!paypal?.canSync) {
      navigate("/connect-paypal");
      return;
    }
    setSyncing(true);
    try {
      const { startDate, endDate } = getDefaultPaypalSyncRange();
      const result = await syncTransactions(startDate, endDate);
      await refreshPaypalAccount();
      toast.success(`PayPal returned ${result.paypalTotalRecordsRetrieved}; ${result.totalRecordsInserted} new, ${result.existingRecordsUpdated} refreshed. ${result.totalRecordsStoredInMongoDB} stored in PayLeak.`);
    } catch (error) {
      toast.error(error.response?.data?.error?.message || error.message || "Could not sync PayPal transactions.");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="OVERVIEW" title="Financial Overview" description="Review PayPal transaction records and actual fees available for your account." action={<><button className="button secondary" onClick={syncPaypal} disabled={syncing}>{syncing ? <span className="spinner" /> : <RefreshCw size={16} />} {paypal?.canSync ? "Sync PayPal" : "Verify PayPal access"}</button><Link className="button primary" to="/invoices/create"><FilePlus2 size={17} /> Create invoice</Link></>} />
      <div className="stats-grid four">
        <StatCard label="Transactions" value={analytics?.transactionCount ?? transactions.length} note="Records stored for your account" icon={Activity} tone="purple" />
        <StatCard label="Gross volume" value={currencySummary(currencies, "totalGross")} note="Kept separate by currency" icon={Wallet} tone="blue" />
        <StatCard label="Verified PayPal fees" value={currencySummary(actualFees, "actualFees")} note={actualFees.length ? "Actual fees returned by PayPal" : "No verified fees available"} icon={CircleDollarSign} tone="orange" />
        <StatCard label="Open invoices" value={invoiceTotals.pending + invoiceTotals.overdue} note={`${invoiceTotals.overdue} overdue · stored in your account`} icon={FilePlus2} tone="red" />
      </div>

      <div className="dashboard-chart-grid">
        <Panel title="Transaction activity" subtitle="Transaction count by month; amounts are never combined across currencies" className="earnings-panel" action={currencies.length > 1 ? <select className="compact-select" value={selectedCurrency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((item) => <option key={item.currency} value={item.currency}>{item.currency}</option>)}</select> : selectedCurrency && <span className="muted">{selectedCurrency}</span>}>
          {monthlyCounts.length ? <div className="chart-wrap earnings-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthlyCounts} margin={{ left: -18, right: 6, top: 10 }}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#929bad", fontSize: 12 }} dy={10} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#929bad", fontSize: 11 }} /><Tooltip formatter={(value) => [`${value} transactions`, "Count"]} contentStyle={{ border: "1px solid #eceef3", borderRadius: 12 }} /><Bar dataKey="count" fill="#8167ff" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div> : <div className="empty-state"><Activity size={23} /><b>No transaction history</b><span>Connect and sync an eligible PayPal merchant account to load records.</span></div>}
        </Panel>
        <Panel title="Gross volume by currency" subtitle="Values come from saved PayPal records">
          {currencies.length ? <div className="breakdown-legend">{currencies.map((item) => <div key={item.currency}><i style={{ background: "#7658f6" }} /><span>{item.currency} · {item.transactionCount} transactions</span><b>{item.totalGross}</b></div>)}</div> : <div className="empty-state"><Wallet size={23} /><b>No financial records yet</b><span>Available totals appear after PayPal transactions are synced.</span></div>}
          {unavailableConversions > 0 && <div className="table-footnote">{unavailableConversions} transaction(s) lack verified conversion data.</div>}
        </Panel>
      </div>

      <div className="dashboard-lower-grid">
        <Panel title="Recent transactions" subtitle="Actual records retrieved for the configured merchant account" action={<Link className="panel-link" to="/leak-analysis">View breakdowns <ArrowRight size={14} /></Link>} className="transactions-panel">
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Transaction</th><th>Client</th><th>Gross</th><th>Actual fee</th><th>Net</th><th>Date</th><th>Status</th></tr></thead><tbody>
            {transactions.slice(0, 8).map((row) => <tr key={row.id}><td><b className="table-primary">{row.id}</b></td><td>{row.client}</td><td>{money(Number(row.gross), row.currency)}</td><td className={row.fee == null ? "" : "loss-text"}>{row.fee == null ? "Unavailable" : money(Number(row.fee), row.feeCurrency || row.currency)}</td><td>{row.net == null ? "Unavailable" : money(Number(row.net), row.currency)}</td><td>{row.date}</td><td><StatusBadge>{row.status}</StatusBadge></td></tr>)}
            {!transactions.length && <tr><td colSpan="7"><div className="empty-state"><Activity size={23} /><b>No synced transactions</b><span>Transactions appear after an authorized server-configured merchant account is synced.</span></div></td></tr>}
          </tbody></table></div>
          <div className="table-footnote">Missing fees, conversions, and payout values remain unavailable; no estimate is substituted.</div>
        </Panel>
        <div className="insights-stack">
          <Panel title="Account insights" subtitle="Based on available records">
            <div className="insight-list">
              <Link to="/leak-analysis" className="insight-item"><span className="insight-icon orange"><CircleDollarSign size={17} /></span><span><b>Fee and conversion details</b><small>{actualFees.length ? "Review verified fees by transaction." : "Verified fee details are not available yet."}</small></span><ArrowRight size={15} /></Link>
              <Link to="/invoices" className="insight-item"><span className="insight-icon red"><FilePlus2 size={17} /></span><span><b>{invoiceTotals.overdue} overdue invoices</b><small>Review your stored invoice records.</small></span><ArrowRight size={15} /></Link>
            </div>
          </Panel>
          <Panel title="Quick actions" className="quick-actions-panel">
            <div className="quick-actions"><Link to="/invoices/create"><FilePlus2 size={16} /> Create invoice</Link><Link to="/leak-analysis"><Activity size={16} /> Analyze transactions</Link></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
