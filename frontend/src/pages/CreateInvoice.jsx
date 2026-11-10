<<<<<<< HEAD
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Bot, CheckCircle2, FilePlus2, LoaderCircle, RotateCw, Send, Sparkles, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { fetchInvoiceCurrencies, understandInvoiceTurn } from "../services/invoiceService.js";
import { money } from "../utils/formatters.js";
import { createEmptyInvoiceAgent, invoicePayloadFromDraft } from "../utils/invoiceAgent.js";
import { paypalCurrencySymbol } from "../utils/paypalCurrencies.js";

export default function CreateInvoice() {
  const [agent, setAgent] = useState(createEmptyInvoiceAgent);
  const [form, setForm] = useState(() => ({ ...agent.draft }));
  const [prompt, setPrompt] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [paypalInvoiceCurrencies, setPaypalInvoiceCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(true);
  const [currenciesError, setCurrenciesError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [savingChanges, setSavingChanges] = useState(false);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const processingRef = useRef(false);
  const operationId = useRef(0);
  const assistantAbortController = useRef(null);
  const {
    createLocalInvoiceDraft,
    publishInvoiceToPaypal,
    updateInvoice,
    deleteInvoice,
    sendInvoice,
  } = useAppData();

  useEffect(() => {
    let active = true;
    fetchInvoiceCurrencies()
      .then((result) => {
        if (active) setPaypalInvoiceCurrencies(result.currencies);
      })
      .catch(() => {
        if (active) setCurrenciesError("PayPal invoice currencies could not be loaded. Refresh and try again.");
      })
      .finally(() => {
        if (active) setCurrenciesLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => { setForm({ ...agent.draft }); }, [agent.draft]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const retryPaypal = async (invoice = agent.invoice, activeAgent = agent, activeOperation = operationId.current, manageProcessing = true) => {
    if (!invoice || invoice.source === "paypal") return invoice;
    if (manageProcessing) setProcessing(true);
    try {
      const linked = await publishInvoiceToPaypal(invoice.id, activeAgent.paypalRequestId);
      if (activeOperation !== operationId.current) return invoice;
      setAgent((current) => ({ ...current, invoice: linked, paypalError: "" }));
      toast.success("PayPal confirmed the invoice draft.");
      setShowPreview(true);
      return linked;
    } catch (error) {
      if (activeOperation !== operationId.current) return invoice;
      const message = error.response?.data?.error?.message || error.message || "PayPal draft creation failed.";
      setAgent((current) => ({ ...current, invoice, paypalError: message }));
      toast.error(`PayLeak saved the draft, but PayPal could not create it: ${message}`);
      return invoice;
    } finally {
      if (manageProcessing && activeOperation === operationId.current) setProcessing(false);
    }
  };

  const createOrUpdateDraft = async (draft, activeAgent, activeOperation) => {
    const payload = invoicePayloadFromDraft(draft);
    let localInvoice = activeAgent.invoice;
    let paypalRequestId = activeAgent.paypalRequestId;
    if (localInvoice) {
      localInvoice = await updateInvoice(localInvoice.id, payload);
      if (localInvoice.source === "payleak") paypalRequestId = crypto.randomUUID();
    } else {
      localInvoice = await createLocalInvoiceDraft(payload, activeAgent.sessionId);
    }
    if (activeOperation !== operationId.current) return null;
    const updatedAgent = { ...activeAgent, invoice: localInvoice, paypalRequestId, paypalError: "" };
    setAgent((current) => ({ ...current, ...updatedAgent }));
    setShowPreview(true);
    if (localInvoice.source === "paypal") {
      toast.success("Your PayPal invoice draft was updated.");
      return localInvoice;
    }
    return retryPaypal(localInvoice, updatedAgent, activeOperation, false);
  };

  const sendMessage = async (event) => {
    event?.preventDefault();
    const message = prompt.trim();
    if (!message || processingRef.current) return;
    processingRef.current = true;
    const activeOperation = ++operationId.current;
    assistantAbortController.current?.abort();
    const controller = new AbortController();
    assistantAbortController.current = controller;
    setProcessing(true);
    const userTurn = { role: "user", text: message };
    const activeAgent = agent;
    const precedingMessages = activeAgent.messages.slice(-12);
    const messages = [...activeAgent.messages, userTurn];
    setAgent((current) => ({ ...current, messages }));
    setPrompt("");
    try {
      const result = await understandInvoiceTurn(message, activeAgent.draft, precedingMessages, controller.signal);
      if (activeOperation !== operationId.current) return;
      const nextAgent = {
        ...activeAgent,
        draft: result.draft,
        messages: [...messages, { role: "assistant", text: result.reply }],
      };
      setAgent(nextAgent);
      setForm({ ...result.draft });
      if (result.intent === "show_invoice") {
        const reply = activeAgent.invoice ? "Here is your current invoice draft preview." : "There is no saved invoice draft in this conversation yet.";
        setAgent((current) => ({ ...current, messages: [...current.messages, { role: "assistant", text: reply }] }));
        if (activeAgent.invoice) setShowPreview(true);
        return;
      }
      if (result.intent === "retry_paypal") {
        if (activeAgent.invoice?.source === "payleak") {
          const retriedInvoice = await retryPaypal(activeAgent.invoice, nextAgent, activeOperation, false);
          if (activeOperation !== operationId.current) return;
          const reply = retriedInvoice.source === "paypal"
            ? `PayPal confirmed draft ${retriedInvoice.invoiceNumber || retriedInvoice.paypalId}. It has not been sent.`
            : "PayPal retry finished. The local PayLeak draft remains saved; review the PayPal status above.";
          setAgent((current) => ({ ...current, messages: [...current.messages, { role: "assistant", text: reply }] }));
        } else {
          const reply = activeAgent.invoice?.source === "paypal"
            ? "This invoice already has a PayPal draft. It has not been sent."
            : "There is no saved local invoice draft to retry yet.";
          setAgent((current) => ({ ...current, messages: [...current.messages, { role: "assistant", text: reply }] }));
        }
        return;
      }
      if (result.ready) {
        const invoice = await createOrUpdateDraft(result.draft, nextAgent, activeOperation);
        if (!invoice || activeOperation !== operationId.current) return;
        setAgent((current) => ({
          ...current,
          invoice,
          paypalError: invoice.source === "payleak" ? current.paypalError : "",
          messages: [
            ...current.messages,
            {
              role: "assistant",
              text: invoice.source === "paypal"
                ? `Your PayPal invoice draft ${invoice.invoiceNumber || invoice.paypalId} is ready. It has not been sent.`
                : "Your PayLeak draft is saved. PayPal did not confirm the draft yet; use Retry PayPal to try again.",
            },
          ],
        }));
      }
    } catch (error) {
      if (activeOperation !== operationId.current || error.name === "CanceledError" || error.name === "AbortError") return;
      const code = error.response?.data?.error?.code;
      const messageText = error.response?.data?.error?.message
        || (code === "VALIDATION_ERROR" ? "The invoice assistant request contains an invalid field. Please check the details and try again." : "")
        || error.message
        || "I couldn't process those invoice details. Please try again.";
      setAgent((current) => ({ ...current, messages: [...current.messages, { role: "assistant", text: messageText }] }));
      toast.error(messageText);
    } finally {
      if (activeOperation === operationId.current) {
        processingRef.current = false;
        assistantAbortController.current = null;
        setProcessing(false);
      }
    }
  };

  const saveChanges = async () => {
    if (!agent.invoice || savingChanges) return;
    const activeOperation = operationId.current;
    setSavingChanges(true);
    try {
      const updated = await updateInvoice(agent.invoice.id, invoicePayloadFromDraft(form));
      if (activeOperation !== operationId.current) return;
      setAgent((current) => ({
        ...current,
        draft: { ...form, amount: updated.amount, lineItems: updated.lineItems ?? form.lineItems },
        invoice: updated,
        paypalRequestId: updated.source === "payleak" ? crypto.randomUUID() : current.paypalRequestId,
        paypalError: "",
      }));
      setForm((current) => ({ ...current, amount: updated.amount, lineItems: updated.lineItems ?? current.lineItems }));
      setEditing(false);
      toast.success("Invoice draft changes saved.");
      setShowPreview(true);
    } catch (error) {
      if (activeOperation !== operationId.current) return;
      const message = error.response?.data?.error?.message || error.message || "Invoice changes could not be saved.";
      toast.error(message);
    } finally {
      if (activeOperation === operationId.current) setSavingChanges(false);
    }
  };

  const sendToCustomer = async () => {
    if (!agent.invoice || agent.invoice.source !== "paypal" || agent.invoice.status !== "Draft" || sending) return;
    const activeOperation = operationId.current;
    setSending(true);
    try {
      const sentInvoice = await sendInvoice(agent.invoice.id);
      if (activeOperation !== operationId.current) return;
      setAgent((current) => ({ ...current, invoice: sentInvoice }));
      toast.success("PayPal confirmed the invoice was sent.");
    } catch (error) {
      if (activeOperation !== operationId.current) return;
      toast.error(error.response?.data?.error?.message || "PayPal could not send the invoice.");
    } finally {
      if (activeOperation === operationId.current) setSending(false);
    }
  };

  const startNewConversation = () => {
    operationId.current += 1;
    assistantAbortController.current?.abort();
    assistantAbortController.current = null;
    processingRef.current = false;
    const next = createEmptyInvoiceAgent();
    setAgent(next);
    setForm({ ...next.draft });
    setPrompt("");
    setProcessing(false);
    setSavingChanges(false);
    setSending(false);
    setDeleting(false);
    setEditing(false);
    setShowPreview(false);
    setConfirmDelete(false);
  };

  const deleteCurrentDraft = async () => {
    if (!agent.invoice || agent.invoice.source !== "payleak" || agent.invoice.status !== "Draft" || deleting) return;
    const activeOperation = operationId.current;
    const invoiceId = agent.invoice.id;
    setDeleting(true);
    try {
      await deleteInvoice(invoiceId);
      if (activeOperation !== operationId.current) return;
      startNewConversation();
      toast.success("Local PayLeak draft deleted. No PayPal invoice was deleted.");
    } catch (error) {
      if (activeOperation !== operationId.current) return;
      toast.error(error.response?.data?.error?.message || "The local draft could not be deleted.");
    } finally {
      if (activeOperation === operationId.current) setDeleting(false);
    }
  };

  const setDraftField = (key, value) => {
    update(key, value);
    setAgent((current) => ({ ...current, draft: { ...current.draft, [key]: value } }));
  };

  const updateLineItem = (index, key, value) => {
    setDraftField("lineItems", (form.lineItems || []).map((item, itemIndex) =>
      itemIndex === index ? { ...item, [key]: value } : item));
  };

  const removeLineItem = (index) => {
    setDraftField("lineItems", (form.lineItems || []).filter((_, itemIndex) => itemIndex !== index));
  };

  const invoice = agent.invoice;
  const currencyMetadata = paypalInvoiceCurrencies.find((item) => item.code === form.currency);

  return (
    <div className="page-enter">
      <PageHeader eyebrow="BILLING / NEW INVOICE" title="Create an invoice" description="Describe the invoice naturally. PayLeak asks for missing details and saves a draft automatically; it will never send without your approval." action={<Link className="button secondary" to="/invoices"><ArrowLeft size={16} /> Back to invoices</Link>} />
      <div className="invoice-create-grid">
        <div className="invoice-form-column">
          <section className="ai-create-card conversational-invoice-card">
            <div className="ai-create-icon"><Sparkles size={18} /></div>
            <div className="ai-create-copy"><b>AI invoice assistant</b><p>Tell me what to invoice, then answer any follow-up questions.</p></div>
            <div className="invoice-conversation" aria-live="polite">
              {agent.messages.length === 0 && <p className="conversation-empty">Example: “Invoice Priya Sharma for website development. Total 50,000 INR, due in 5 days. Include frontend development, backend development, and deployment.”</p>}
              {agent.messages.map((entry, index) => (
                <div className={`conversation-message ${entry.role}`} key={`${index}-${entry.role}`}>
                  <b>{entry.role === "assistant" ? "PayLeak AI" : "You"}</b>
                  <p>{entry.text}</p>
                </div>
              ))}
              {processing && <div className="conversation-progress"><LoaderCircle size={14} className="spin" /> Understanding and validating invoice details…</div>}
            </div>
            <form className="ai-prompt-row" onSubmit={sendMessage}>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe an invoice or answer the assistant…" rows="2" disabled={processing} />
              <button className="button dark-button" type="submit" disabled={processing || editing || !prompt.trim()}>{processing ? <LoaderCircle size={15} className="spin" /> : <><Send size={15} /> Send</>}</button>
            </form>
            <div className="conversation-footer">
              <span><Bot size={13} /> {editing ? "Save or cancel draft edits before continuing the conversation." : "Structured details are validated by PayLeak before draft creation."}</span>
              <button type="button" className="text-button" onClick={startNewConversation}>New invoice</button>
            </div>
          </section>

          <section className="panel form-panel">
            <div className="panel-heading"><div><h2>Invoice details</h2><p>{editing ? "Edit the draft and save your changes." : "These fields update as the conversation progresses."}</p></div><span className="step-count">01 <i /> 02</span></div>
            <div className="form-grid">
              <label className="field-label">Client name *<input value={form.client} onChange={(event) => setDraftField("client", event.target.value)} placeholder="e.g. Priya Sharma" /></label>
              <label className="field-label">Client email *<input type="email" value={form.email} onChange={(event) => setDraftField("email", event.target.value)} placeholder="client@company.com" /></label>
              <label className="field-label">Project<input value={form.project || ""} onChange={(event) => setDraftField("project", event.target.value)} placeholder="Project name" /></label>
              <label className="field-label">Amount *<div className="amount-field"><span>{paypalCurrencySymbol(form.currency)}</span><input type="number" min={currencyMetadata?.fractionDigits === 0 ? "1" : "0.01"} step={currencyMetadata?.fractionDigits === 0 ? "1" : "0.01"} value={form.amount} onChange={(event) => setDraftField("amount", event.target.value)} placeholder="0.00" readOnly={Boolean(form.lineItems?.length)} /></div>{form.lineItems?.length > 0 && <small>Calculated from priced line items.</small>}</label>
              <label className="field-label">Currency *<select value={form.currency} onChange={(event) => setDraftField("currency", event.target.value)} disabled={currenciesLoading || Boolean(currenciesError)}>
                <option value="">{currenciesLoading ? "Loading currencies…" : "Select currency"}</option>
                {paypalInvoiceCurrencies.map(({ code, name, symbol }) => <option key={code} value={code}>{name} ({code} · {symbol})</option>)}
              </select></label>
              <label className="field-label">Invoice date<input type="date" value={form.date} onChange={(event) => setDraftField("date", event.target.value)} /></label>
              <label className="field-label">Due date *<input type="date" value={form.due} onChange={(event) => setDraftField("due", event.target.value)} /></label>
              <label className="field-label full-span">Services<textarea rows="2" value={(form.services || []).join(", ")} onChange={(event) => setDraftField("services", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} placeholder="Frontend development, backend development, deployment" /></label>
              {form.lineItems?.length > 0 && <div className="field-label full-span"><span>Priced line items</span>{form.lineItems.map((item, index) => <div className="invoice-line-item-editor" key={`${index}-${item.description}`}><input aria-label={`Line item ${index + 1} description`} value={item.description} onChange={(event) => updateLineItem(index, "description", event.target.value)} disabled={!editing} /><input aria-label={`Line item ${index + 1} amount`} type="number" min="0.01" step={currencyMetadata?.fractionDigits === 0 ? "1" : "0.01"} value={item.amount} onChange={(event) => updateLineItem(index, "amount", event.target.value)} disabled={!editing} /><button className="text-button" type="button" onClick={() => removeLineItem(index)} disabled={!editing || form.lineItems.length <= 1}>Remove</button></div>)}{editing && <button className="button secondary small-button" type="button" onClick={() => setDraftField("lineItems", [...form.lineItems, { description: "", amount: "" }])}>Add line item</button>}</div>}
              <label className="field-label full-span">Service description *<textarea rows="3" value={form.description} onChange={(event) => setDraftField("description", event.target.value)} placeholder="Complete description shown on the invoice" /></label>
              {currenciesError && <p className="inline-error full-span" role="alert">{currenciesError}</p>}
            </div>
            <div className="form-footer"><span><CheckCircle2 size={15} /> Draft creation is automatic after required details are complete</span>{invoice && <button className="button secondary" type="button" onClick={() => setShowPreview(true)}>Preview draft</button>}</div>
            {invoice && editing && <div className="form-actions"><button className="button primary" onClick={saveChanges} disabled={savingChanges}>{savingChanges ? <LoaderCircle size={15} className="spin" /> : <CheckCircle2 size={15} />} Save Changes</button><button className="button secondary" onClick={() => { setForm({ ...agent.draft }); setEditing(false); }}>Cancel</button></div>}
          </section>
        </div>
        <aside className="invoice-side-note">
          <div className="side-note-icon"><FilePlus2 size={19} /></div><h3>Draft and approval</h3><p>PayLeak saves a local draft before trying PayPal. Sending to the customer is a separate action that requires you to choose “Send via PayPal.”</p>
          <div className="side-note-rule" /><div className="side-note-row"><CheckCircle2 size={15} /><span>AI asks for missing required details</span></div><div className="side-note-row"><CheckCircle2 size={15} /><span>PayPal confirms currency and account availability</span></div><div className="side-note-row"><CheckCircle2 size={15} /><span>Invoices are never sent automatically</span></div>
          {invoice && <div className="saved-record"><b>{invoice.source === "paypal" ? "PayPal draft" : "PayLeak local draft"}</b><span>{invoice.paypalId || invoice.id}</span><small>Status: {invoice.paypalStatus || invoice.status}</small>{agent.paypalError && <><small className="inline-error">{agent.paypalError}</small><button className="button secondary small-button" onClick={() => retryPaypal()} disabled={processing}><RotateCw size={13} /> Retry PayPal</button></>}</div>}
        </aside>
      </div>
      {showPreview && invoice && <Modal title="Invoice draft preview" onClose={() => setShowPreview(false)}>
        <div className="invoice-preview">
          <div className="preview-brand">pay<span>leak</span><small>DRAFT · NOT SENT</small></div>
          <div className="preview-line"><span>Invoice to</span><b>{form.client || "—"}</b><small>{form.email || "—"}</small></div>
          <div className="preview-line"><span>Project</span><b>{form.project || "—"}</b></div>
          {form.lineItems?.length > 0
            ? <div className="preview-line preview-line-items"><span>Line items</span>{form.lineItems.map((item, index) => <div key={`${index}-${item.description}`}><span>{item.description}</span><b>{form.currency ? money(Number(item.amount) || 0, form.currency) : item.amount}</b></div>)}</div>
            : <div className="preview-line"><span>Services</span><b>{(form.services || []).join(", ") || "—"}</b></div>}
          <div className="preview-line"><span>Invoice date</span><b>{form.date || "—"}</b></div>
          <div className="preview-line"><span>Due date</span><b>{form.due || "—"}</b></div>
          <div className="preview-description">{form.description || "—"}</div>
          <div className="preview-total"><span>Total due ({form.currency})</span><b>{form.currency ? money(Number(form.amount) || 0, form.currency) : "—"}</b></div>
          <div className="preview-line"><span>PayPal invoice ID</span><b>{invoice.paypalId || "Not created yet"}</b></div>
          <div className="preview-line"><span>Draft status</span><b>{invoice.paypalStatus || invoice.status}</b></div>
          {agent.paypalError && <p className="inline-error" role="alert">PayLeak saved the draft, but PayPal creation failed: {agent.paypalError}</p>}
        </div>
        <div className="modal-actions invoice-agent-actions">
          {invoice.source === "payleak" && <button className="button secondary" onClick={() => retryPaypal()} disabled={processing}><RotateCw size={14} /> Retry PayPal</button>}
          {invoice.status === "Draft" && <button className="button secondary" onClick={() => { setShowPreview(false); setEditing(true); }}>Edit Draft</button>}
          {editing && <button className="button secondary" onClick={saveChanges} disabled={savingChanges}>Save Changes</button>}
          {invoice.source === "paypal" && invoice.status === "Draft" && <button className="button primary" onClick={sendToCustomer} disabled={sending}>{sending ? "Sending…" : "Send via PayPal"}</button>}
          {invoice.source === "payleak" && invoice.status === "Draft" && !invoice.paypalId && <button className="button secondary" onClick={() => setConfirmDelete(true)} disabled={deleting}><Trash2 size={14} /> Delete Draft</button>}
        </div>
      </Modal>}
      {confirmDelete && invoice && <Modal title="Delete local draft?" onClose={() => setConfirmDelete(false)}>
        <div className="confirmation-copy">
          <p>Delete the unsent PayLeak draft for <b>{invoice.client}</b>?</p>
          <p className="muted">This removes only the local draft record. It does not cancel or delete anything in PayPal. This action cannot be undone.</p>
        </div>
        <div className="modal-actions">
          <button className="button secondary" onClick={() => setConfirmDelete(false)} disabled={deleting}>Keep Draft</button>
          <button className="button danger-outline" onClick={deleteCurrentDraft} disabled={deleting}>{deleting ? "Deleting…" : "Delete Draft"}</button>
        </div>
      </Modal>}
    </div>
  );
=======
export default function CreateInvoice() {
  return <main><h1>Create invoice</h1><p>Invoice creation will be built here.</p></main>;
>>>>>>> dcb877a2283b466bc7b3821e56fd18eed33a0452
}
