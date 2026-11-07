import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, Send, ShieldCheck } from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import Panel from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { money } from "../data/demoData.js";

export default function InvoiceDetails() {
  const { invoiceId } = useParams();
  const navigate = useNavigate();
  const { invoices, updateInvoiceStatus } = useAppData();
  const invoice = invoices.find((item) => item.id === decodeURIComponent(invoiceId || ""));

  if (!invoice) {
    return <div className="page-enter"><PageHeader title="Invoice not found" description="This invoice is not in your local demo data." action={<Link className="button secondary" to="/invoices"><ArrowLeft size={16} /> Back to invoices</Link>} /><div className="panel empty-state"><FileText size={25} /><b>No matching invoice</b></div></div>;
  }

  return (
    <div className="page-enter">
      <PageHeader eyebrow="BILLING / INVOICE DETAILS" title={invoice.id} description="Review the saved invoice details. This is a local demo record." action={<Link className="button secondary" to="/invoices"><ArrowLeft size={16} /> Back to invoices</Link>} />
      <div className="invoice-detail-layout">
        <Panel title="Invoice overview" subtitle="Fictional record · not issued through PayPal" action={<StatusBadge>{invoice.status}</StatusBadge>}>
          <div className="invoice-detail-total"><span>Total amount</span><b>{money(invoice.amount, invoice.currency)}</b><small>{invoice.currency} · DEMO DATA</small></div>
          <div className="invoice-detail-grid"><div><span>Invoice number</span><b>{invoice.id}</b></div><div><span>Invoice date</span><b>{invoice.date}</b></div><div><span>Due date</span><b>{invoice.due}</b></div><div><span>Payment status</span><b><StatusBadge>{invoice.status}</StatusBadge></b></div></div>
          <div className="invoice-client-block"><span className="eyebrow">BILL TO</span><b>{invoice.client}</b><small>{invoice.email}</small></div>
          <div className="invoice-description-block"><span>Description</span><p>{invoice.description}</p></div>
          <div className="invoice-detail-actions"><button className="button secondary" onClick={() => window.print()}><Download size={15} /> Print / Save PDF</button>{invoice.status === "Draft" && <button className="button primary" onClick={() => { if (!window.confirm("Mark this invoice as sent in your local demo data? No email or PayPal invoice will be sent.")) return; updateInvoiceStatus(invoice.id, "Sent"); toast.success("Invoice marked as sent in demo data."); }}><Send size={15} /> Send demo invoice</button>}</div>
        </Panel>
        <aside className="detail-security-note"><ShieldCheck size={19} /><b>Demo invoice</b><p>This invoice exists only in your browser’s demo data. It has not been sent to PayPal or your client.</p>{invoice.paypalId && <small>Demo reference: {invoice.paypalId}</small>}<button onClick={() => navigate("/invoices/create")}>Create another invoice</button></aside>
      </div>
    </div>
  );
}
