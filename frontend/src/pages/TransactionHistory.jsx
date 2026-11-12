import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import Modal from "../components/Modal.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { fetchTransaction, fetchTransactionPage } from "../services/transactionService.js";
import { money, transactionStatusLabel, transactionTypeLabel } from "../utils/formatters.js";

const PAGE_SIZE = 25;

function errorMessage(error) {
  return error.response?.data?.error?.message || error.message || "The transaction request failed.";
}

function displayAmount(value, currency) {
  return value == null ? "Unavailable" : money(value, currency || "USD");
}

export default function TransactionHistory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTransactionId = searchParams.get("transaction") || "";
  const [page, setPage] = useState(1);
  const [currency, setCurrency] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(requestedTransactionId);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (requestedTransactionId) setSelectedId(requestedTransactionId);
  }, [requestedTransactionId]);

  useEffect(() => {
    const controller = new AbortController();
    const params = { page, limit: PAGE_SIZE };
    if (currency) params.currency = currency.toUpperCase();
    if (status) params.status = status;
    if (from) params.from = from;
    if (to) params.to = to;

    setLoading(true);
    setError("");
    fetchTransactionPage(params, controller.signal)
      .then(setResult)
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(errorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, currency, status, from, to]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const controller = new AbortController();
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    fetchTransaction(selectedId, controller.signal)
      .then(setDetail)
      .catch((requestError) => {
        if (!controller.signal.aborted) setDetailError(errorMessage(requestError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const resetFilters = () => {
    setCurrency("");
    setStatus("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  return (
    <div className="page-enter">
      <PageHeader
        eyebrow="PAYMENTS"
        title="Transaction history"
        description="Transactions stored for your account, with details loaded directly from PayLeak."
        action={<Link to="/connect-paypal" className="button secondary"><ExternalLink size={16} /> PayPal settings</Link>}
      />
      <Panel title="Your transactions" subtitle={`${result.total} transaction${result.total === 1 ? "" : "s"} · newest first`} className="invoice-table-panel">
        <div className="table-toolbar transaction-filters">
          <label className="table-search">
            <Search size={16} />
            <input aria-label="Filter by currency" maxLength={3} value={currency} onChange={(event) => { setCurrency(event.target.value.replace(/[^a-z]/gi, "").slice(0, 3)); setPage(1); }} placeholder="Currency (e.g. USD)" />
          </label>
          <select className="compact-select" aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="S">Completed</option>
            <option value="P">Pending</option>
            <option value="V">Reversed</option>
          </select>
          <label className="compact-select">From <input aria-label="From date" type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} /></label>
          <label className="compact-select">To <input aria-label="To date" type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} /></label>
          <button className="button secondary small-button" onClick={resetFilters} disabled={!currency && !status && !from && !to}>Clear filters</button>
        </div>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Transaction</th><th>Payer</th><th>Gross</th><th>Fee</th><th>Net</th><th>Date</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {result.items.map((transaction) => (
                <tr key={transaction.id}>
                  <td><b className="table-primary">{transaction.id}</b></td>
                  <td>{transaction.client || "Unknown payer"}</td>
                  <td><b>{money(transaction.gross, transaction.currency)}</b></td>
                  <td>{displayAmount(transaction.fee, transaction.feeCurrency || transaction.currency)}</td>
                  <td>{displayAmount(transaction.net, transaction.currency)}</td>
                  <td>{transaction.date}</td>
                  <td><StatusBadge>{transactionStatusLabel(transaction.status)}</StatusBadge></td>
                  <td><button className="button secondary small-button" onClick={() => setSelectedId(transaction.id)}>View</button></td>
                </tr>
              ))}
              {!loading && result.items.length === 0 && (
                <tr><td colSpan="8"><div className="empty-state"><RefreshCw size={23} /><b>{error ? "Transactions could not be loaded" : "No transactions found"}</b><span>{error ? "Retry by refreshing the page." : "Try changing the filters or sync PayPal transactions from the dashboard."}</span></div></td></tr>
              )}
              {loading && result.items.length === 0 && <tr><td colSpan="8"><div className="empty-state"><span className="spinner" /> Loading transactions…</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-toolbar">
          <span className="table-footnote">Showing {result.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, result.total)} of {result.total}</span>
          <div className="pagination-controls">
            <button className="button secondary small-button" disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>Previous</button>
            <span>Page {page} of {pageCount}</span>
            <button className="button secondary small-button" disabled={page >= pageCount || loading} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        </div>
      </Panel>

      {selectedId && (
        <Modal title="Transaction details" onClose={() => {
          setSelectedId("");
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete("transaction");
          setSearchParams(nextParams, { replace: true });
        }}>
          {detailLoading && <div className="page-loading"><span className="spinner" /> Loading transaction…</div>}
          {detailError && <div className="inline-error" role="alert">{detailError}</div>}
          {detail && (
            <div className="transaction-detail-list">
              <p><span>PayPal transaction ID</span><b>{detail.id}</b></p>
              <p><span>Type</span><b>{transactionTypeLabel(detail.transactionType)}</b></p>
              <p><span>Status</span><StatusBadge>{transactionStatusLabel(detail.status)}</StatusBadge></p>
              <p><span>Payer</span><b>{detail.client || "Unknown payer"}</b></p>
              <p><span>Date</span><b>{detail.date}</b></p>
              <p><span>Gross amount</span><b>{money(detail.gross, detail.currency)}</b></p>
              <p><span>PayPal fee</span><b>{displayAmount(detail.fee, detail.feeCurrency || detail.currency)}</b></p>
              <p><span>Net amount</span><b>{displayAmount(detail.net, detail.currency)}</b></p>
              <p><span>Financial data</span><b>{detail.financialDataStatus}</b></p>
              <p><span>Retrieved</span><b>{detail.retrievedAt ? new Date(detail.retrievedAt).toLocaleString() : "Unavailable"}</b></p>
              <div className="modal-actions"><Link className="button secondary" to={`/leak-analysis?transaction=${encodeURIComponent(detail.id)}`} onClick={() => setSelectedId("")}>View fee analysis</Link></div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
