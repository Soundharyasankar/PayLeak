import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Bot, CheckCircle2, Eye, FilePlus2, Send, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { extractInvoiceDetails } from "../services/invoiceService.js";
import { money } from "../data/demoData.js";

const blankInvoice = { client: "", email: "", amount: "", currency: "USD", description: "", date: new Date().toISOString().slice(0, 10), due: "" };

export default function CreateInvoice() {
  const [form, setForm] = useState(blankInvoice);
  const [prompt, setPrompt] = useState("");
  const [modal, setModal] = useState("");
  const [saved, setSaved] = useState(null);
  const { createInvoice } = useAppData();
  const navigate = useNavigate();

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const extract = () => {
    if (!prompt.trim()) return toast.error("Describe the invoice you want to create.");
    setForm((current) => ({ ...current, ...extractInvoiceDetails(prompt) }));
    toast.success("Details extracted. Review and edit before saving.");
  };
  const validate = () => {
    if (!form.client.trim() || !form.email.includes("@") || Number(form.amount) <= 0 || !form.description.trim() || !form.due) {
      toast.error("Complete the client, valid email, amount, description, and due date.");
      return false;
    }
    return true;
  };
  const save = (status) => {
    if (!validate()) return;
    const invoice = createInvoice(form, status);
    setSaved(invoice);
    if (status === "Sent") {
      setModal("");
      toast.success("Demo invoice marked as sent. No email was delivered.");
    } else {
      toast.success("Invoice saved to your demo list.");
    }
    if (status === "Draft") navigate("/invoices");
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="BILLING / NEW INVOICE" title="Create an invoice" description="Add the details below, preview your invoice, then decide whether to save or send it." action={<Link className="button secondary" to="/invoices"><ArrowLeft size={16} /> Back to invoices</Link>} />
      <div className="invoice-create-grid">
        <div className="invoice-form-column">
          <section className="ai-create-card">
            <div className="ai-create-icon"><Sparkles size={18} /></div>
            <div className="ai-create-copy"><b>Draft it with AI</b><p>Describe the invoice. We’ll fill a draft for you to review.</p></div>
            <div className="ai-prompt-row"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Create an invoice for John Smith for $1,000 for website development, due in 15 days." rows="2" /><button className="button dark-button" onClick={extract}><Bot size={16} /> Extract details</button></div>
            <span className="demo-caption"><Sparkles size={13} /> Local demo extraction · always review before use</span>
          </section>
          <section className="panel form-panel">
            <div className="panel-heading"><div><h2>Invoice details</h2><p>Fields marked with * are required.</p></div><span className="step-count">01 <i /> 02</span></div>
            <div className="form-grid">
              <label className="field-label">Client name *<input value={form.client} onChange={(event) => update("client", event.target.value)} placeholder="e.g. Jordan Lee" /></label>
              <label className="field-label">Client email *<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="client@company.com" /></label>
              <label className="field-label">Amount *<div className="amount-field"><span>{form.currency === "EUR" ? "€" : form.currency === "GBP" ? "£" : form.currency === "INR" ? "₹" : "$"}</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => update("amount", event.target.value)} placeholder="0.00" /></div></label>
              <label className="field-label">Currency<select value={form.currency} onChange={(event) => update("currency", event.target.value)}>{["USD", "EUR", "GBP", "INR"].map((currency) => <option key={currency}>{currency}</option>)}</select></label>
              <label className="field-label full-span">Service description *<textarea rows="3" value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Describe the work or services provided" /></label>
              <label className="field-label">Invoice date<input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} /></label>
              <label className="field-label">Due date *<input type="date" value={form.due} onChange={(event) => update("due", event.target.value)} /></label>
            </div>
            <div className="form-footer"><span><CheckCircle2 size={15} /> You can review before sending</span><button className="button secondary" onClick={() => setModal("preview")}><Eye size={16} /> Preview invoice</button></div>
          </section>
          <div className="form-actions"><button className="button secondary" onClick={() => save("Draft")}>Save draft</button><button className="button primary" onClick={() => { if (validate()) setModal("send"); }}><Send size={16} /> Review &amp; send</button></div>
        </div>
        <aside className="invoice-side-note">
          <div className="side-note-icon"><FilePlus2 size={19} /></div><h3>Before you send</h3><p>This prototype does not connect to PayPal or email clients. Sending will only create a clearly labelled demo record.</p>
          <div className="side-note-rule" /><div className="side-note-row"><CheckCircle2 size={15} /><span>Confirm client details and currency</span></div><div className="side-note-row"><CheckCircle2 size={15} /><span>Check your due date and description</span></div><div className="side-note-row"><CheckCircle2 size={15} /><span>Review the preview before confirming</span></div>
          {saved && <div className="saved-record"><b>Last created demo invoice</b><span>{saved.id}</span><small>PayPal ID: {saved.paypalId}</small><small>Status: {saved.status} · demo only</small><a href={saved.link} onClick={(event) => { event.preventDefault(); toast("This is a non-functional demo invoice link."); }}>View demo invoice link</a></div>}
        </aside>
      </div>
      {modal === "preview" && <Modal title="Invoice preview" onClose={() => setModal("")}><div className="invoice-preview"><div className="preview-brand">pay<span>leak</span><small>DEMO INVOICE · NOT SENT</small></div><div className="preview-line"><span>Invoice to</span><b>{form.client || "Client name"}</b><small>{form.email || "client@email.com"}</small></div><div className="preview-line"><span>Invoice date</span><b>{form.date || "—"}</b></div><div className="preview-line"><span>Due date</span><b>{form.due || "—"}</b></div><div className="preview-description">{form.description || "Service description"}</div><div className="preview-total"><span>Total due</span><b>{money(Number(form.amount) || 0, form.currency)}</b></div></div><div className="modal-actions"><button className="button secondary" onClick={() => setModal("")}>Continue editing</button><button className="button primary" onClick={() => { setModal(""); toast("Preview looks good. Review all fields before sending."); }}>Looks good</button></div></Modal>}
      {modal === "send" && <Modal title="Confirm demo invoice" onClose={() => setModal("")}><div className="confirmation-copy"><div className="confirm-icon"><Send size={20} /></div><p>Mark this invoice for <b>{form.client}</b> as sent in your local demo data?</p><p className="muted">No PayPal invoice will be created and no email will be delivered.</p><div className="confirm-total">{money(Number(form.amount) || 0, form.currency)} <span>{form.currency}</span></div></div><div className="modal-actions"><button className="button secondary" onClick={() => setModal("")}>Cancel</button><button className="button primary" onClick={() => save("Sent")}>Confirm demo send</button></div></Modal>}
    </div>
  );
}
