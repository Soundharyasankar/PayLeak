import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Download, Eye, FilePlus2, Search, Send, SlidersHorizontal } from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import Panel from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { getInvoiceTotals, money } from "../data/demoData.js";

export default function Invoices() {
  const { invoices } = useAppData();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("search") || "");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const navigate = useNavigate();
  const totals = getInvoiceTotals(invoices);
  const filtered = useMemo(() => invoices.filter((invoice) => {
    const matchesText = `${invoice.id} ${invoice.client} ${invoice.email}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === "All statuses" || invoice.status === statusFilter;
    return matchesText && matchesStatus;
  }), [invoices, query, statusFilter]);

  const exportCsv = () => {
    const csv = ["Invoice,Client,Email,Amount,Currency,Date,Due,Status", ...filtered.map((item) => [item.id, item.client, item.email, item.amount, item.currency, item.date, item.due, item.status].join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "payleak-demo-invoices.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Demo invoice list exported.");
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="BILLING" title="Invoice Management" description="Create, send and track your international invoices." action={<Link to="/invoices/create" className="button primary"><FilePlus2 size={17} /> Create invoice</Link>} />
      <div className="stats-grid four">
        <StatCard label="Total invoices" value={totals.total} note="Across all statuses" icon={FilePlus2} tone="purple" />
        <StatCard label="Paid invoices" value={totals.paid} note="Successfully settled" icon={Send} tone="green" />
        <StatCard label="Pending invoices" value={totals.pending} note="Draft or awaiting payment" icon={Eye} tone="blue" />
        <StatCard label="Overdue invoices" value={totals.overdue} note="Needs your attention" icon={SlidersHorizontal} tone="red" />
      </div>
      <Panel title="Your invoices" subtitle={`${filtered.length} invoice${filtered.length === 1 ? "" : "s"} · all amounts are fictional demo records`} className="invoice-table-panel" action={<button className="button secondary small-button" onClick={exportCsv}><Download size={15} /> Export</button>}>
        <div className="table-toolbar">
          <label className="table-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search invoice or client..." /></label>
          <select className="compact-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>All statuses</option>{["Draft", "Sent", "Paid", "Overdue", "Cancelled"].map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="table-scroll"><table className="data-table invoice-table"><thead><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Currency</th><th>Invoice date</th><th>Due date</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {filtered.map((invoice) => <tr key={invoice.id}><td><b className="table-primary">{invoice.id}</b><small className="table-secondary">{invoice.description}</small></td><td><b>{invoice.client}</b><small className="table-secondary">{invoice.email}</small></td><td><b>{money(invoice.amount, invoice.currency)}</b></td><td>{invoice.currency}</td><td>{invoice.date}</td><td>{invoice.due}</td><td><StatusBadge>{invoice.status}</StatusBadge></td><td><button className="icon-button table-action" title="View invoice" aria-label={`View ${invoice.id}`} onClick={() => navigate(`/invoices/${encodeURIComponent(invoice.id)}`)}><Eye size={16} /></button></td></tr>)}
          {filtered.length === 0 && <tr><td colSpan="7"><div className="empty-state"><Search size={23} /><b>No invoices match</b><span>Try another search or status filter.</span></div></td></tr>}
        </tbody></table></div>
        <div className="table-footnote">Invoices are mock records. No invoice is sent until you review and confirm.</div>
      </Panel>
    </div>
  );
}
