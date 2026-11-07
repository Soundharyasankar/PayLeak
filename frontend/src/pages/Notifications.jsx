import { useMemo, useState } from "react";
import { Bell, Check, CheckCheck, CircleDollarSign, FileText, Lightbulb, MoreHorizontal, Send, Sparkles, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../components/Modal.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { useAppData } from "../context/AppContext.jsx";

const categories = ["All notifications", "Payment", "Invoice", "Financial alert", "AI recommendation"];
const categoryIcon = { Payment: CircleDollarSign, Invoice: FileText, "Financial alert": Bell, "AI recommendation": Lightbulb };

export default function Notifications() {
  const { notifications, updateNotifications, invoices } = useAppData();
  const [filter, setFilter] = useState("All notifications");
  const [reminder, setReminder] = useState(null);
  const [reminderText, setReminderText] = useState("");
  const filtered = useMemo(() => filter === "All notifications" ? notifications : notifications.filter((item) => item.category === filter), [notifications, filter]);
  const unread = notifications.filter((item) => item.unread).length;
  const change = (id, patch) => updateNotifications(notifications.map((item) => item.id === id ? { ...item, ...patch } : item));

  const draftReminder = (invoice) => {
    setReminder(invoice);
    setReminderText(`Hi ${invoice.client},\n\nI hope you're doing well. This is a friendly reminder that invoice ${invoice.id} for ${new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency }).format(invoice.amount)} was due on ${invoice.due}. Please let me know if you have any questions.\n\nThank you!`);
  };

  const confirmReminder = () => {
    if (!reminderText.trim()) return toast.error("Add a reminder message before continuing.");
    setReminder(null);
    toast.success("Reminder approved in demo mode. No message was sent.");
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="ACTIVITY CENTER" title="Notifications & Alerts" description="Stay updated about invoices, payments and financial opportunities." action={<button className="button secondary" onClick={() => { updateNotifications(notifications.map((item) => ({ ...item, unread: false }))); toast.success("All notifications marked as read."); }}><CheckCheck size={16} /> Mark all as read</button>} />
      <div className="notification-summary"><div className="notification-summary-icon"><Bell size={19} /></div><div><b>{unread} unread notifications</b><span>Across payments, invoices, and financial insights</span></div><span className="notification-summary-meta">{notifications.length} total</span></div>
      <div className="notification-tabs">{categories.map((category) => <button className={filter === category ? "active" : ""} key={category} onClick={() => setFilter(category)}>{category}{category === "All notifications" && <span>{notifications.length}</span>}</button>)}</div>
      <div className="notifications-grid">
        <section className="notification-list">
          {filtered.map((item) => {
            const Icon = categoryIcon[item.category] || Bell;
            return <article className={`notification-item ${item.unread ? "unread" : ""}`} key={item.id}><span className={`notification-icon ${item.category.toLowerCase().replace(" ", "-")}`}><Icon size={18} /></span><div className="notification-content"><div className="notification-item-title"><b>{item.title}</b>{item.unread && <i />}</div><p>{item.body}</p><small>{item.category} <span>·</span> {item.time}</small></div><div className="notification-actions"><button title={item.unread ? "Mark as read" : "Mark as unread"} onClick={() => change(item.id, { unread: !item.unread })}>{item.unread ? <Check size={16} /> : <CheckCheck size={16} />}</button><button title="Delete notification" onClick={() => { updateNotifications(notifications.filter((notification) => notification.id !== item.id)); toast.success("Notification deleted."); }}><Trash2 size={15} /></button></div></article>;
          })}
          {filtered.length === 0 && <div className="empty-state"><Bell size={24} /><b>No notifications here</b><span>Try a different category.</span></div>}
        </section>
        <aside className="reminder-panel panel"><div className="panel-heading"><div><h2>Overdue follow-ups</h2><p>Review and approve before sending</p></div><MoreHorizontal size={17} /></div>
          {invoices.filter((invoice) => invoice.status === "Overdue").map((invoice) => <div className="overdue-reminder" key={invoice.id}><div className="overdue-icon"><FileText size={16} /></div><div className="overdue-info"><b>{invoice.client}</b><small>{invoice.id} · {new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency }).format(invoice.amount)}</small><span>Due {invoice.due}</span></div><button className="button secondary small-button" onClick={() => draftReminder(invoice)}>Draft reminder</button></div>)}
          <div className="reminder-note"><Sparkles size={15} /><span>Reminder drafts are suggestions only. Review and approve them yourself. No email will be sent in this demo.</span></div>
        </aside>
      </div>
      {reminder && <Modal title="Review invoice reminder" onClose={() => setReminder(null)}><div className="reminder-preview-label"><span>TO</span><b>{reminder.client} · {reminder.email}</b></div><label className="field-label">Message preview<textarea className="reminder-textarea" rows="8" value={reminderText} onChange={(event) => setReminderText(event.target.value)} /></label><p className="muted small-copy">Review and edit this message before approval. It will not be delivered from the demo.</p><div className="modal-actions"><button className="button secondary" onClick={() => setReminder(null)}>Cancel</button><button className="button primary" onClick={confirmReminder}><Send size={15} /> Approve demo reminder</button></div></Modal>}
    </div>
  );
}
