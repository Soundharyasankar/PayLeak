import { useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, Clock3, Info, ShieldAlert, Sparkles } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import { calculateRoute, rankRoutes } from "../utils/calculations.js";
import { money } from "../data/demoData.js";

const pairRates = {
  USD: { INR: 83.2, EUR: 0.92, GBP: 0.79 },
  EUR: { INR: 90.4, USD: 1.08, GBP: 0.86 },
  GBP: { INR: 105.2, USD: 1.27, EUR: 1.16 },
  INR: { USD: 1 / 83.2, EUR: 1 / 90.4, GBP: 1 / 105.2 },
};

const routeDefinitions = [
  { id: "paypal", name: "PayPal conversion", short: "PayPal", fixed: 0, percent: 3.5, spread: 0.965, hours: 24, time: "1–3 business days", risk: "Low", riskScore: 1, type: "paypal", note: "Illustrative PayPal-style spread. Not an actual quote." },
  { id: "hold", name: "Hold original currency", short: "Hold currency", fixed: 2, percent: 0.8, spread: 0.99, hours: 48, time: "2–5 business days", risk: "Medium", riskScore: 2, type: "hold", note: "Conditional estimate. Eligible withdrawal and bank conversion must be verified." },
  { id: "external", name: "External converter", short: "External", fixed: 4, percent: 0.6, spread: 0.995, hours: 12, time: "Same day–2 days", risk: "Medium", riskScore: 2, type: "external", provider: "Illustrative provider", note: "Simulated, informational route. Provider availability and eligibility not checked." },
  { id: "pyusd", name: "PYUSD route", short: "PYUSD", fixed: 8, percent: 1.4, spread: 0.985, hours: 72, time: "1–4 days", risk: "High", riskScore: 3, type: "crypto", note: "Simulated only. Platform, network, exchange, and regulatory risks apply." },
];

export default function RouteOptimizer() {
  const [amount, setAmount] = useState("1000");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("INR");
  const [priority, setPriority] = useState("Cheapest");
  const [optimized, setOptimized] = useState(true);
  const rate = from === to ? 1 : pairRates[from]?.[to] || 1;
  const routes = useMemo(() => routeDefinitions.map((definition) => {
    const calculation = calculateRoute(Number(amount) || 0, rate * definition.spread, definition.fixed, definition.percent, rate);
    return { ...definition, ...calculation, exchangeRate: rate * definition.spread };
  }), [amount, rate]);
  const ranked = rankRoutes(routes, priority);
  const recommended = ranked[0];
  const paypalRoute = routes.find((route) => route.id === "paypal");
  const formatInput = (value) => money(value, from);
  const formatOutput = (value) => money(value, to);

  const optimize = (event) => {
    event.preventDefault();
    if (Number(amount) <= 0 || !Number.isFinite(Number(amount))) return;
    setOptimized(true);
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="SMART TOOLS / ROUTES" title="Smart Route Optimizer" description="Compare illustrative conversion and withdrawal paths before making your own decision." />
      <form className="route-input-panel" onSubmit={optimize}>
        <label className="field-label">Amount<input type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="field-label">From currency<select value={from} onChange={(event) => setFrom(event.target.value)}>{["USD", "INR", "EUR", "GBP"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="route-swap"><ArrowRight size={17} /></div>
        <label className="field-label">To currency<select value={to} onChange={(event) => setTo(event.target.value)}>{["INR", "USD", "EUR", "GBP"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="field-label">Optimize for<select value={priority} onChange={(event) => { setPriority(event.target.value); setOptimized(false); }}><option>Cheapest</option><option>Fastest</option><option>Lowest Risk</option></select></label>
        <button className="button primary optimize-button" type="submit"><Sparkles size={16} /> Optimize my route</button>
      </form>
      {optimized && <div className="recommended-route">
        <div className="recommend-icon"><BadgeCheck size={22} /></div><div className="recommend-copy"><span>RECOMMENDED · {priority.toUpperCase()}</span><h2>{recommended.name}</h2><p>{priority === "Cheapest" ? "Ranks highest by estimated amount received." : priority === "Fastest" ? "Ranks first by illustrative processing time." : "Ranks first by the demo risk score."} All routes are estimates, not executable offers.</p></div>
        <div className="recommend-number"><small>Estimated amount out</small><b>{formatOutput(recommended.finalAmount)}</b><span>Est. savings {formatOutput(Math.max(0, recommended.finalAmount - paypalRoute.finalAmount))} vs. PayPal demo</span></div>
      </div>}
      <div className="route-section-heading"><div><h2>Compare your routes</h2><p>Amount in: {formatInput(Number(amount) || 0)} <ArrowRight size={13} /> Amount out: {to}</p></div><span className="demo-pill"><span /> SIMULATED ESTIMATES</span></div>
      <div className="route-cards">
        {ranked.map((route, index) => <article className={`route-card ${optimized && index === 0 ? "best-route" : ""}`} key={route.id}>
          <div className="route-card-top"><div className={`route-logo ${route.type}`}>{route.type === "paypal" ? "P" : route.type === "crypto" ? "₿" : route.short.slice(0, 1)}</div><div className="route-title"><b>{route.name}</b><small>{route.provider || "Estimated conversion route"}</small></div>{optimized && index === 0 && <span className="best-chip">BEST MATCH</span>}</div>
          <div className="route-flow"><span>{from} balance</span><ArrowRight size={14} /><span>{route.type === "crypto" ? "PYUSD · exchange" : route.type === "hold" ? "Hold · bank conversion" : route.name}</span><ArrowRight size={14} /><span>{to} account</span></div>
          <div className="route-result"><small>Estimated amount received</small><b>{formatOutput(route.finalAmount)}</b><span className="route-loss">{formatInput(route.fees)} estimated total route costs</span></div>
          <div className="route-facts"><div><span>Rate</span><b>{route.exchangeRate.toFixed(4)}</b></div><div><span>Time</span><b><Clock3 size={13} /> {route.time}</b></div><div><span>Risk</span><b className={`risk-${route.risk.toLowerCase()}`}>{route.risk}</b></div></div>
          <div className="route-disclaimer"><Info size={14} /><span>{route.note}</span></div>
        </article>)}
      </div>
      <Panel title="Route comparison" subtitle="Amounts use the same demo inputs and deterministic fee assumptions." className="route-table-panel">
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Route</th><th>Total fees (input)</th><th>Exchange rate</th><th>Final amount</th><th>Estimated time</th><th>Risk</th><th>vs. PayPal route</th></tr></thead><tbody>
          {ranked.map((route) => <tr key={route.id}><td><b>{route.name}</b>{route.id !== "paypal" && <small className="table-secondary">Simulated / informational</small>}</td><td>{formatInput(route.fees)}</td><td>{route.exchangeRate.toFixed(4)}</td><td><b>{formatOutput(route.finalAmount)}</b></td><td>{route.time}</td><td><span className={`risk-label risk-${route.risk.toLowerCase()}`}>{route.risk}</span></td><td className={route.finalAmount >= paypalRoute.finalAmount ? "text-green" : ""}>{route.id === "paypal" ? "Baseline" : formatOutput(route.finalAmount - paypalRoute.finalAmount)}</td></tr>)}
        </tbody></table></div>
      </Panel>
      <div className="warning-note"><ShieldAlert size={17} /><span><b>Comparison only — no transfers.</b> These fictional estimates are not live PayPal or provider offers. Routes involving external providers, holding balances, or PYUSD may not be available or eligible. Verify all fees, rates, risks, and terms independently. Never transfer funds based only on this comparison.</span></div>
    </div>
  );
}
