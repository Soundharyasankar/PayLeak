import { useMemo, useState } from "react";
import { Bell, Check, CheckCheck, CircleDollarSign, FileText, Lightbulb, MoreHorizontal, Send, Sparkles, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { draftReminder as requestReminderDraft, sendReminder } from "../services/notificationService.js";

const categories = ["All notifications", "Payment", "Invoice", "Financial alert", "AI recommendation", "Sync"];
const categoryIcon = { Payment: CircleDollarSign, Invoice: FileText, "Financial alert": Bell, "AI recommendation": Lightbulb, Sync: Bell };

export default function Notifications() {
  const { notifications, updateNotification, updateNotifications, removeNotification, invoices } = useAppData();
  const [filter, setFilter] = useState("All notifications");
  const [reminder, setReminder] = useState(null);
  const [reminderText, setReminderText] = useState("");
  const [reminderError, setReminderError] = useState("");
  const [working, setWorking] = useState(false);
  const filtered = useMemo(() => filter === "All notifications" ? notifications : notifications.filter((item) => item.category === filter), [notifications, filter]);
  const unread = notifications.filter((item) => item.unread).length;

  const changeRead = async (id, read) => {
    try {
      await updateNotification(id, read);
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Could not update the notification.");
    }
  };

  const markAllRead = async () => {
    try {
      await updateNotifications();
      toast.success("All notifications marked as read.");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Could not update notifications.");
    }
  };

  const remove = async (id) => {
    try {
      await removeNotification(id);
      toast.success("Notification deleted.");
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Could not delete the notification.");
    }
  };

  const prepareReminder = async (invoice) => {
    setWorking(true);
    setReminderError("");
    try {
      const draft = await requestReminderDraft(invoice.id);
      setReminder({ ...invoice, email: draft.to });
      setReminderText(draft.message);
    } catch (error) {
      toast.error(error.response?.data?.error?.message || "Could not prepare a reminder.");
    } finally {
      setWorking(false);
    }
  };

  const submitReminder = async () => {
    if (!reminderText.trim()) return toast.error("Add a reminder message before continuing.");
    setWorking(true);
    setReminderError("");
    try {
      await sendReminder(reminder.id);
      toast.success("Reminder sent.");
      setReminder(null);
    } catch (error) {
      setReminderError(error.response?.data?.error?.message || "Reminder delivery is not configured. Nothing was sent.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="ACTIVITY CENTER" title="Notifications & Alerts" description="Review account notifications stored by PayLeak." action={<button className="button secondary" onClick={markAllRead} disabled={!unread}><CheckCheck size={16} /> Mark all as read</button>} />
      <div className="notification-summary"><div className="notification-summary-icon"><Bell size={19} /></div><div><b>{unread} unread notifications</b><span>Payments, invoices, and account updates</span></div><span className="notification-summary-meta">{notifications.length} total</span></div>
      <div className="notification-tabs">{categories.map((category) => <button className={filter === category ? "active" : ""} key={category} onClick={() => setFilter(category)}>{category}{category === "All notifications" && <span>{notifications.length}</span>}</button>)}</div>
      <div className="notifications-grid">
        <section className="notification-list">
          {filtered.map((item) => {
            const Icon = categoryIcon[item.category] || Bell;
            return <article className={`notification-item ${item.unread ? "unread" : ""}`} key={item.id}><span className={`notification-icon ${item.category.toLowerCase().replace(" ", "-")}`}><Icon size={18} /></span><div className="notification-content"><div className="notification-item-title"><b>{item.title}</b>{item.unread && <i />}</div><p>{item.body}</p><small>{item.category} <span>·</span> {new Date(item.time).toLocaleString()}</small></div><div className="notification-actions"><button title={item.unread ? "Mark as read" : "Mark as unread"} onClick={() => void changeRead(item.id, !item.unread)}>{item.unread ? <Check size={16} /> : <CheckCheck size={16} />}</button><button title="Delete notification" onClick={() => void remove(item.id)}><Trash2 size={15} /></button></div></article>;
          })}
          {filtered.length === 0 && <div className="empty-state"><Bell size={24} /><b>No notifications</b><span>New account notifications will appear here.</span></div>}
        </section>
        <aside className="reminder-panel panel"><div className="panel-heading"><div><h2>Overdue follow-ups</h2><p>Review and approve before delivery</p></div><MoreHorizontal size={17} /></div>
          {invoices.filter((invoice) => invoice.status === "Overdue").map((invoice) => <div className="overdue-reminder" key={invoice.id}><div className="overdue-icon"><FileText size={16} /></div><div className="overdue-info"><b>{invoice.client}</b><small>{invoice.invoiceNumber || invoice.id} · {new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency }).format(Number(invoice.amount))}</small><span>Due {invoice.due || "date not specified"}</span></div><button className="button secondary small-button" onClick={() => void prepareReminder(invoice)} disabled={working}>Draft reminder</button></div>)}
          <div className="reminder-note"><Sparkles size={15} /><span>Reminder drafts are stored only when sent through a configured delivery integration. PayLeak will report if delivery is unavailable.</span></div>
        </aside>
      </div>
      {reminder && <Modal title="Review invoice reminder" onClose={() => { setReminder(null); setReminderError(""); }}><div className="reminder-preview-label"><span>TO</span><b>{reminder.client} · {reminder.email}</b></div><label className="field-label">Message preview<textarea className="reminder-textarea" rows="8" value={reminderText} onChange={(event) => setReminderText(event.target.value)} /></label>{reminderError && <p className="text-red">{reminderError}</p>}<p className="muted small-copy">The backend must confirm delivery. Approval alone never marks a reminder as sent.</p><div className="modal-actions"><button className="button secondary" onClick={() => setReminder(null)}>Cancel</button><button className="button primary" onClick={submitReminder} disabled={working}>{working ? <span className="spinner" /> : <><Send size={15} /> Send reminder</>}</button></div></Modal>}
    </div>
  );
}
