import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CircleDollarSign, FilePlus2, Lightbulb, Radar, Sparkles, Wallet } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import Panel from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { getEarningsByMonth, getLeakTotals, money } from "../data/demoData.js";

export default function Dashboard() {
  const [period, setPeriod] = useState("6 months");
  const { transactions } = useAppData();
  const usdRates = { USD: 1, EUR: 1.08, GBP: 1.27, INR: 0.012 };
  const grossEarnings = transactions.reduce((sum, item) => sum + item.gross * (usdRates[item.currency] || 1), 0);
  const costs = getLeakTotals(transactions);
  const netEarnings = Math.max(0, grossEarnings - costs.fees - costs.conversion - costs.other);
  const savingsEstimate = grossEarnings * 0.0195;
  const compactGross = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(grossEarnings);
  const earnings = getEarningsByMonth(transactions);
  const previousMonth = earnings.at(-2)?.gross || 0;
  const currentMonth = earnings.at(-1)?.gross || 0;
  const monthlyChange = previousMonth ? ((currentMonth - previousMonth) / previousMonth * 100).toFixed(1) : "0.0";
  const breakdown = [
    { name: "Transaction fees", value: costs.fees, color: "#7b61ff" },
    { name: "Conversion loss", value: costs.conversion, color: "#ff9f6b" },
    { name: "Net earnings", value: netEarnings, color: "#2dbf91" },
  ];
  const rows = transactions.slice(0, 5);

  return (
    <div className="page-enter">
      <PageHeader eyebrow="OVERVIEW" title="Financial Overview" description="Track your earnings, identify hidden costs and discover potential savings." action={<Link className="button primary" to="/invoices/create"><FilePlus2 size={17} /> Create invoice</Link>} />
      <div className="stats-grid four">
        <StatCard label="Total earnings" value={money(grossEarnings)} change={`${Number(monthlyChange) >= 0 ? "+" : ""}${monthlyChange}%`} note="Monthly change · USD-equivalent demo data" icon={Wallet} tone="purple" />
        <StatCard label="Transaction fees" value={money(costs.fees)} note={`${transactions.length} sample transactions · USD equivalent`} icon={CircleDollarSign} tone="orange" />
        <StatCard label="Currency loss" value={money(costs.conversion)} note="Estimated · USD equivalent" icon={ArrowDownRight} tone="red" />
        <StatCard label="Potential savings" value={money(savingsEstimate)} note="Illustrative alternative-route estimate" icon={Radar} tone="green" />
      </div>

      <div className="dashboard-chart-grid">
        <Panel title="Earnings overview" subtitle="Gross payment compared with net received" className="earnings-panel" action={<select className="compact-select" value={period} onChange={(event) => setPeriod(event.target.value)}><option>6 months</option><option>3 months</option><option>This year</option></select>}>
          <div className="chart-legend"><span><i className="legend-dot purple-dot" /> Gross volume</span><span><i className="legend-dot green-dot" /> Net after transaction fees</span></div>
          <div className="chart-wrap earnings-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={period === "3 months" ? earnings.slice(-3) : earnings} margin={{ left: -18, right: 6, top: 10 }}>
                <defs><linearGradient id="grossFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8167ff" stopOpacity={0.17} /><stop offset="100%" stopColor="#8167ff" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#edf0f5" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#929bad", fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#929bad", fontSize: 11 }} tickFormatter={(value) => `$${value / 1000}k`} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ border: "1px solid #eceef3", borderRadius: 12, boxShadow: "0 10px 24px #17203312" }} />
                <Area type="monotone" dataKey="gross" stroke="#8167ff" strokeWidth={2.5} fill="url(#grossFill)" />
                <Line type="monotone" dataKey="net" stroke="#2dbf91" strokeWidth={2.5} dot={{ r: 3, fill: "#2dbf91", strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Payment breakdown" subtitle="Across included sample transactions">
          <div className="breakdown-chart">
            <div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={breakdown} innerRadius={58} outerRadius={80} dataKey="value" stroke="none" paddingAngle={3}>{breakdown.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip formatter={(value) => money(value)} /></PieChart></ResponsiveContainer><div className="donut-center"><b>{compactGross}</b><span>gross volume</span></div></div>
            <div className="breakdown-legend">{breakdown.map((item) => <div key={item.name}><i style={{ background: item.color }} /><span>{item.name}</span><b>{money(item.value)}</b></div>)}</div>
          </div>
        </Panel>
      </div>

      <div className="dashboard-lower-grid">
        <Panel title="Recent transactions" subtitle="Latest sample payment activity · amounts are in the listed currency" action={<Link className="panel-link" to="/leak-analysis">Analyze all <ArrowRight size={14} /></Link>} className="transactions-panel">
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Transaction</th><th>Client</th><th>Gross amount</th><th>Fee</th><th>Currency</th><th>Net amount</th><th>Date</th><th>Status</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.id}><td><b className="table-primary">{row.id}</b></td><td>{row.client}</td><td>{money(row.gross, row.currency)}</td><td className="loss-text">{money(row.fee, row.currency)}</td><td>{row.currency}</td><td><b>{money(row.net, row.currency)}</b></td><td>{new Date(`${row.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td><td><StatusBadge>{row.status}</StatusBadge></td></tr>)}
          </tbody></table></div>
          <div className="table-footnote">All entries are fictional demo data.</div>
        </Panel>
        <div className="insights-stack">
          <Panel title="Financial insights" subtitle="A few things worth a look">
            <div className="insight-list">
              <Link to="/leak-analysis" className="insight-item"><span className="insight-icon orange"><ArrowUpRight size={17} /></span><span><b>Conversion costs moved up</b><small>Your demo estimates show a 1.7% rate difference.</small></span><ArrowRight size={15} /></Link>
              <Link to="/route-optimizer" className="insight-item"><span className="insight-icon purple"><Radar size={17} /></span><span><b>Compare alternative routes</b><small>Explore illustrative route estimates before converting.</small></span><ArrowRight size={15} /></Link>
              <Link to="/invoices" className="insight-item"><span className="insight-icon red"><Lightbulb size={17} /></span><span><b>3 overdue invoices</b><small>Review reminders before following up with clients.</small></span><ArrowRight size={15} /></Link>
            </div>
          </Panel>
          <Panel title="Quick actions" className="quick-actions-panel">
            <div className="quick-actions">
              <Link to="/invoices/create"><FilePlus2 size={16} /> Create invoice</Link>
              <Link to="/leak-analysis"><Radar size={16} /> Analyze payments</Link>
              <Link to="/route-optimizer"><ArrowRight size={16} /> Optimize routes</Link>
              <Link to="/ai-assistant"><Sparkles size={16} /> Ask AI assistant</Link>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
