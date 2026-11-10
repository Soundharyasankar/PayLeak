import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, ShieldCheck, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { money } from "../utils/formatters.js";

export default function InvoiceDetails() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { invoices, sendInvoice, publishInvoiceToPaypal, deleteInvoice } = useAppData();
  const [sending, setSending] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const publishRequestId = useRef(null);
  const invoice = invoices.find((item) => item.id === decodeURIComponent(invoiceId || ""));

  const sendToCustomer = async () => {
    if (!invoice || sending) return;
    setSending(true);
    try {
      const updated = await sendInvoice(invoice.id);
      toast.success(`PayPal confirmed invoice status: ${updated.status}.`);
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "PayPal could not send this invoice.");
    } finally {
      setSending(false);
    }
  };

  const createInPaypal = async () => {
    if (!invoice || publishing) return;
    setPublishing(true);
    try {
      publishRequestId.current ||= crypto.randomUUID();
      const updated = await publishInvoiceToPaypal(invoice.id, publishRequestId.current);
      publishRequestId.current = null;
      toast.success(`PayPal confirmed draft ${updated.invoiceNumber || updated.paypalId}.`);
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "PayPal could not create this invoice.");
    } finally {
      setPublishing(false);
    }
  };

  const deleteLocalDraft = async () => {
    if (!invoice || invoice.source !== "payleak" || invoice.status !== "Draft" || invoice.paypalId || deleting) return;
    setDeleting(true);
    try {
      await deleteInvoice(invoice.id);
      toast.success("Local PayLeak draft deleted. No PayPal invoice was deleted.");
      navigate("/invoices");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "The local draft could not be deleted.");
    } finally {
      setDeleting(false);
    }
  };

  if (!invoice) {
    return <div className="page-enter"><PageHeader title="Invoice not found" description="No matching invoice exists in your account." action={<Link className="button secondary" to="/invoices"><ArrowLeft size={16} /> Back to invoices</Link>} /><div className="panel empty-state"><FileText size={25} /><b>No matching invoice</b></div></div>;
  }

  return (
    <div className="page-enter">
      <PageHeader eyebrow="BILLING / INVOICE DETAILS" title={invoice.invoiceNumber || invoice.id} description="Review the invoice record saved in your PayLeak account." action={<Link className="button secondary" to="/invoices"><ArrowLeft size={16} /> Back to invoices</Link>} />
      <div className="invoice-detail-layout">
        <Panel title="Invoice overview" subtitle={invoice.source === "paypal" ? "Imported from PayPal" : "Created in PayLeak"} action={<StatusBadge>{invoice.status}</StatusBadge>}>
          <div className="invoice-detail-total"><span>Total amount</span><b>{money(invoice.amount, invoice.currency)}</b><small>{invoice.currency}</small></div>
          <div className="invoice-detail-grid"><div><span>Invoice number</span><b>{invoice.invoiceNumber || invoice.id}</b></div>{invoice.paypalId && <div><span>PayPal invoice ID</span><b>{invoice.paypalId}</b></div>}<div><span>Invoice date</span><b>{invoice.date}</b></div><div><span>Due date</span><b>{invoice.due || "Not specified"}</b></div><div><span>Payment status</span><b><StatusBadge>{invoice.status}</StatusBadge></b></div>{invoice.paypalStatus && <div><span>PayPal status</span><b>{invoice.paypalStatus}</b></div>}{invoice.paypalLastSyncedAt && <div><span>Last synced</span><b>{new Date(invoice.paypalLastSyncedAt).toLocaleString()}</b></div>}{invoice.subtotal != null && <div><span>Subtotal</span><b>{money(invoice.subtotal, invoice.currency)}</b></div>}{invoice.tax != null && <div><span>Tax</span><b>{money(invoice.tax, invoice.currency)}</b></div>}{invoice.paymentAmount != null && <div><span>Paid amount</span><b>{money(invoice.paymentAmount, invoice.currency)}</b></div>}{invoice.paymentDate && <div><span>Payment date</span><b>{invoice.paymentDate}</b></div>}</div>
          <div className="invoice-client-block"><span className="eyebrow">BILL TO</span><b>{invoice.client}</b><small>{invoice.email}</small></div>
          <div className="invoice-description-block"><span>Description</span><p>{invoice.description}</p></div>
          <div className="invoice-detail-actions"><button className="button secondary" onClick={() => window.print()}><Download size={15} /> Print / Save PDF</button>{invoice.invoiceUrl && <a className="button secondary" href={invoice.invoiceUrl} target="_blank" rel="noreferrer">Open PayPal invoice</a>}{invoice.source === "payleak" && invoice.status === "Draft" && <button className="button primary" onClick={createInPaypal} disabled={publishing}>{publishing ? "Creating…" : "Create draft in PayPal"}</button>}{invoice.source === "paypal" && invoice.status === "Draft" && <button className="button primary" onClick={sendToCustomer} disabled={sending}>{sending ? "Sending…" : "Send via PayPal"}</button>}{invoice.source === "payleak" && invoice.status === "Draft" && !invoice.paypalId && <button className="button danger-outline" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete Draft</button>}</div>
        </Panel>
        <aside className="detail-security-note"><ShieldCheck size={19} /><b>Invoice source</b><p>{invoice.source === "paypal" ? `Imported from PayPal. Reference: ${invoice.paypalId || "not available"}.` : "Created and stored in PayLeak. This draft has not been sent."}</p><button onClick={() => navigate("/invoices/create")}>Create another invoice</button></aside>
      </div>
      {confirmDelete && <Modal title="Delete local draft?" onClose={() => !deleting && setConfirmDelete(false)}>
        <div className="confirmation-copy">
          <p>Delete the unsent PayLeak draft for <b>{invoice.client}</b>?</p>
          <p className="muted">Only the local draft record will be removed. This will not cancel or delete a PayPal invoice. This action cannot be undone.</p>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep Draft</button>
          <button className="button danger-outline" onClick={deleteLocalDraft} disabled={deleting}>{deleting ? "Deleting…" : "Delete Draft"}</button>
        </div>
      </Modal>}
    </div>
  );
}
