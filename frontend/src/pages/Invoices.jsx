import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Download, Eye, FilePlus2, RefreshCw, Search, Send, SlidersHorizontal, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import Panel from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { getInvoiceTotals, money } from "../utils/formatters.js";
import { diagnosePaypalInvoices } from "../services/invoiceService.js";

const PAGE_SIZE = 10;

function errorMessage(error) {
  return error.response?.data?.error?.message || error.message || "Invoice request failed.";
}

export default function Invoices() {
  const { invoices, syncInvoices, deleteInvoice, loading, error: accountError } = useAppData();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get("search") || "");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [page, setPage] = useState(1);
  const [syncing, setSyncing] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [syncDiagnostics, setSyncDiagnostics] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const totals = getInvoiceTotals(invoices);
  const filtered = useMemo(() => invoices.filter((invoice) => {
    const matchesText = `${invoice.invoiceNumber || ""} ${invoice.id} ${invoice.client} ${invoice.email}`.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === "All statuses" || invoice.status === statusFilter;
    return matchesText && matchesStatus;
  }), [invoices, query, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visibleInvoices = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCsv = () => {
    const csv = ["Invoice,Client,Email,Amount,Currency,Date,Due,Status,Source", ...filtered.map((item) => [item.invoiceNumber || item.id, item.client, item.email, item.amount, item.currency, item.date, item.due || "", item.status, item.source].map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "payleak-invoices.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    toast.success("Invoice list exported.");
  };

  const syncPayPal = async () => {
    setSyncing(true);
    setRequestError("");
    setSyncDiagnostics(null);
    try {
      const result = await syncInvoices();
      setSyncDiagnostics(result);
      setPage(1);
      toast.success(`PayPal returned ${result.invoicesRetrieved} invoices; ${result.invoicesInserted} new, ${result.invoicesUpdated} updated.`);
    } catch (syncError) {
      setRequestError(errorMessage(syncError));
      setSyncDiagnostics(syncError.response?.data?.error?.details || null);
      toast.error(errorMessage(syncError));
    } finally {
      setSyncing(false);
    }
  };

  const verifyPayPal = async () => {
    setDiagnosing(true);
    setRequestError("");
    try {
      const result = await diagnosePaypalInvoices();
      setSyncDiagnostics(result);
      if (result.invoiceApiAccess !== "authorized") {
        setRequestError(result.guidance);
        toast.error(result.guidance);
      } else {
        toast.success(result.guidance);
      }
    } catch (diagnosticError) {
      setRequestError(errorMessage(diagnosticError));
      toast.error(errorMessage(diagnosticError));
    } finally {
      setDiagnosing(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate || deleting) return;
    setDeleting(true);
    try {
      await deleteInvoice(deleteCandidate.id);
      toast.success("Local PayLeak draft deleted. No PayPal invoice was deleted.");
      setDeleteCandidate(null);
    } catch (deleteError) {
      toast.error(errorMessage(deleteError));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="BILLING" title="Invoice Management" description="Review PayLeak invoices and import existing invoices from your authorized PayPal Sandbox account." action={<><button className="button secondary" onClick={verifyPayPal} disabled={diagnosing || syncing}>{diagnosing ? <span className="spinner" /> : <Search size={16} />} Verify PayPal access</button><button className="button secondary" onClick={syncPayPal} disabled={syncing || diagnosing}>{syncing ? <span className="spinner" /> : <RefreshCw size={16} />} Sync PayPal invoices</button><Link to="/invoices/create" className="button primary"><FilePlus2 size={17} /> Create invoice</Link></>} />
      <div className="stats-grid four">
        <StatCard label="Total invoices" value={totals.total} note="Across all statuses" icon={FilePlus2} tone="purple" />
        <StatCard label="Paid invoices" value={totals.paid} note="Successfully settled" icon={Send} tone="green" />
        <StatCard label="Pending invoices" value={totals.pending} note="Draft, sent, or partially paid" icon={Eye} tone="blue" />
        <StatCard label="Overdue invoices" value={totals.overdue} note="Needs your attention" icon={SlidersHorizontal} tone="red" />
      </div>
      {requestError && <div className="inline-error" role="alert">{requestError}</div>}
      {accountError && <div className="inline-error" role="alert">{accountError}</div>}
      {syncDiagnostics && <details className="paypal-sync-diagnostics" open>
        <summary>PayPal invoice synchronization diagnostics</summary>
        <dl>
          <dt>Environment</dt><dd>{syncDiagnostics.environment}</dd>
          <dt>Integration scope</dt><dd>{syncDiagnostics.integrationScope || "shared"}</dd>
          <dt>PayPal OAuth</dt><dd>{syncDiagnostics.applicationOAuth || "not verified"}</dd>
          <dt>PayPal application ID</dt><dd>{syncDiagnostics.paypalApplicationId || "not reported"}</dd>
          <dt>Client ID suffix</dt><dd>{syncDiagnostics.clientIdLast4 || "not reported"}</dd>
          <dt>Merchant identity</dt><dd>{syncDiagnostics.merchantAccount || "not available from app OAuth"}</dd>
          <dt>Invoice read permission</dt><dd>{syncDiagnostics.invoiceReadPermission || "not verified"}</dd>
          <dt>Invoice write permission</dt><dd>{syncDiagnostics.invoiceWritePermission || "not verified"}</dd>
          <dt>Invoice read OAuth scope</dt><dd>{syncDiagnostics.invoiceReadScopeClaim || "not reported"}</dd>
          <dt>Invoice write OAuth scope</dt><dd>{syncDiagnostics.invoiceWriteScopeClaim || "not reported"}</dd>
          <dt>Invoice API read test</dt><dd>{syncDiagnostics.invoiceApiAccess || "not tested"}</dd>
          <dt>Invoice create permission</dt><dd>{syncDiagnostics.invoiceCreatePermission || "not tested"}</dd>
          <dt>Invoice send permission</dt><dd>{syncDiagnostics.invoiceSendPermission || "not tested"}</dd>
          <dt>PayPal HTTP status</dt><dd>{syncDiagnostics.paypalHttpStatus ?? syncDiagnostics.paypalApiError?.httpStatus ?? "not requested"}</dd>
          <dt>PayPal total_items</dt><dd>{syncDiagnostics.paypalTotalItems ?? "not returned"}</dd>
          <dt>PayPal total_pages</dt><dd>{syncDiagnostics.paypalTotalPages ?? "not returned"}</dd>
          <dt>Invoices retrieved</dt><dd>{syncDiagnostics.invoicesRetrieved ?? 0}</dd>
          <dt>Invoice detail requests</dt><dd>{syncDiagnostics.invoiceDetailsRetrieved ?? 0}</dd>
          <dt>Invoices inserted</dt><dd>{syncDiagnostics.invoicesInserted ?? 0}</dd>
          <dt>Invoices updated</dt><dd>{syncDiagnostics.invoicesUpdated ?? 0}</dd>
          <dt>Duplicates skipped</dt><dd>{syncDiagnostics.duplicateInvoicesSkipped ?? 0}</dd>
          <dt>Stored in MongoDB</dt><dd>{syncDiagnostics.totalInvoicesStoredInMongoDB ?? 0}</dd>
        </dl>
        {syncDiagnostics.paypalApiError && <div className="paypal-diagnostic-error" role="status"><b>PayPal API error</b><span>{syncDiagnostics.paypalApiError.name || "Unknown"} · HTTP {syncDiagnostics.paypalApiError.httpStatus ?? "unknown"}</span><span>{syncDiagnostics.paypalApiError.message || "No message returned."}</span><span>debug_id: {syncDiagnostics.paypalApiError.debugId || "not provided"}</span></div>}
        {syncDiagnostics.guidance && <p>{syncDiagnostics.guidance}</p>}
        {syncDiagnostics.pages?.map((item) => <p key={item.page}>Page {item.page}/{item.totalPages} · HTTP {item.httpStatus ?? "unknown"} · {item.returnedItems} invoice records</p>)}
      </details>}
      <Panel title="Your invoices" subtitle={`${filtered.length} invoice${filtered.length === 1 ? "" : "s"} · saved to your account`} className="invoice-table-panel" action={<button className="button secondary small-button" onClick={exportCsv} disabled={!filtered.length}><Download size={15} /> Export</button>}>
        <div className="table-toolbar">
          <label className="table-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search invoice number or customer..." /></label>
          <select className="compact-select" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option>All statuses</option>{["Draft", "Sent", "Partially Paid", "Paid", "Overdue", "Cancelled", "Refunded"].map((item) => <option key={item}>{item}</option>)}</select>
        </div>
        <div className="table-scroll"><table className="data-table invoice-table"><thead><tr><th>Invoice</th><th>Client</th><th>Amount</th><th>Currency</th><th>Invoice date</th><th>Due date</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {visibleInvoices.map((invoice) => <tr key={invoice.id}><td><b className="table-primary">{invoice.invoiceNumber || invoice.id}</b><small className="table-secondary">{invoice.source === "paypal" ? "PayPal invoice" : "PayLeak invoice"}{invoice.description ? ` · ${invoice.description}` : ""}</small></td><td><b>{invoice.client}</b><small className="table-secondary">{invoice.email}</small></td><td><b>{money(invoice.amount, invoice.currency)}</b></td><td>{invoice.currency}</td><td>{invoice.date}</td><td>{invoice.due || "—"}</td><td><StatusBadge>{invoice.status}</StatusBadge></td><td><button className="icon-button table-action" title="View invoice" aria-label={`View ${invoice.invoiceNumber || invoice.id}`} onClick={() => navigate(`/invoices/${encodeURIComponent(invoice.id)}`)}><Eye size={16} /></button>{invoice.source === "payleak" && invoice.status === "Draft" && !invoice.paypalId && <button className="icon-button table-action" title="Delete local draft" aria-label={`Delete draft for ${invoice.client}`} onClick={() => setDeleteCandidate(invoice)}><Trash2 size={16} /></button>}</td></tr>)}
          {!loading && visibleInvoices.length === 0 && <tr><td colSpan="8"><div className="empty-state"><Search size={23} /><b>{requestError ? "Invoices could not be loaded from PayPal" : "No invoices match"}</b><span>{requestError ? "Check the PayPal access diagnostics above. Existing PayLeak invoices, if any, remain unchanged." : "Try another search or status filter, or sync PayPal invoices."}</span></div></td></tr>}
          {loading && visibleInvoices.length === 0 && <tr><td colSpan="8"><div className="empty-state"><span className="spinner" /> Loading invoices…</div></td></tr>}
        </tbody></table></div>
        <div className="table-toolbar"><span className="table-footnote">Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}</span><div className="pagination-controls"><button className="button secondary small-button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button className="button secondary small-button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>
        <div className="table-footnote">PayPal invoices are imported only after PayPal grants Invoicing API read access. Local and PayPal invoices remain distinguishable.</div>
      </Panel>
      {deleteCandidate && <Modal title="Delete local draft?" onClose={() => !deleting && setDeleteCandidate(null)}>
        <div className="confirmation-copy">
          <p>Delete the unsent PayLeak draft for <b>{deleteCandidate.client}</b>?</p>
          <p className="muted">Only the local draft record will be removed. This will not cancel or delete a PayPal invoice. This action cannot be undone.</p>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={() => setDeleteCandidate(null)} disabled={deleting}>Keep Draft</button>
          <button className="button danger-outline" onClick={confirmDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete Draft"}</button>
        </div>
      </Modal>}
    </div>
  );
}
