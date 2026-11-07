import { useState } from "react";
import { ArrowUp, Bot, CirclePlus, MessageSquare, MoreHorizontal, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { askAssistant } from "../services/aiService.js";
import { calculateLeak } from "../utils/calculations.js";
import { money } from "../data/demoData.js";

const suggestions = [
  "Why did I lose money on my last transaction?",
  "Which conversion route is cheapest?",
  "How much money did I lose this month?",
  "Show me my overdue invoices.",
  "How can I reduce my payment fees?",
  "Explain my last PayPal transaction.",
];

export default function AIAssistant() {
  const { transactions, invoices } = useAppData();
  const [messages, setMessages] = useState(() => {
    const transaction = transactions[0];
    if (!transaction) return [];
    const analysis = calculateLeak(transaction, "INR");
    return [
      { role: "user", text: `Why did I receive less than the gross amount on ${transaction.id}?` },
      { role: "assistant", text: `This sample transaction shows a ${money(transaction.fee, transaction.currency)} transaction fee. At the illustrative reference rate, the conversion difference is ${money(analysis.conversionLoss, "INR")}; including the fee converted at the estimated rate, the total identified impact is ${money(analysis.totalLoss, "INR")}. These are demo estimates, not verified PayPal records.`, source: "Demo data · calculation-based" },
    ];
  });
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (value = question) => {
    const text = value.trim();
    if (!text || loading) return;
    setQuestion("");
    setMessages((current) => [...current, { role: "user", text }]);
    setLoading(true);
    try {
      const answer = await askAssistant(text, transactions);
      setMessages((current) => [...current, { role: "assistant", ...answer }]);
    } catch (error) {
      console.error("AI assistant request failed.", error);
      toast.error("The assistant could not answer. Please try again.");
      setMessages((current) => [...current, { role: "assistant", text: "I couldn’t reach the connected assistant. Please retry, or use one of the demo questions.", source: "Connection error" }]);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setMessages([]);
    toast.success("Conversation cleared.");
  };

  const overdue = invoices.filter((invoice) => invoice.status === "Overdue").length;
  return (
    <div className="page-enter">
      <PageHeader eyebrow="PAYLEAK INTELLIGENCE" title="AI Financial Assistant" description="Your intelligent assistant for international payments, grounded in available demo data." />
      <div className="chat-layout">
        <aside className="chat-history">
          <div className="history-heading"><b>Conversations</b><button className="icon-button" onClick={clear} aria-label="Clear conversation"><Plus size={17} /></button></div>
          <button className="new-chat-button" onClick={clear}><CirclePlus size={16} /> New conversation</button>
          <span className="history-date">TODAY</span>
          <button className="history-item active"><MessageSquare size={15} /><span>Payment insights</span><MoreHorizontal size={15} /></button>
          <span className="history-date">SAVED CONTEXT</span>
          <div className="history-context"><b>Demo account summary</b><small>{transactions.length} sample transactions</small><small>{overdue} overdue sample invoices</small><small>Fictional data · not verified</small></div>
          <div className="history-disclaimer"><Sparkles size={14} /> Responses use demo records. Financial figures are not independently verified.</div>
        </aside>
        <section className="chat-panel">
          <header className="chat-header"><span className="assistant-avatar"><Bot size={19} /></span><div><b>PayLeak AI</b><small><i /> Demo data context enabled</small></div><button className="chat-clear-button" onClick={clear}><Trash2 size={15} /> Clear conversation</button></header>
          <div className="chat-messages">
            {messages.length === 0 && <div className="chat-empty"><span className="assistant-avatar large"><Sparkles size={23} /></span><h2>What would you like to understand?</h2><p>Ask about your transactions, invoice list, or sample route estimates.</p></div>}
            {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`chat-message ${message.role}`}><span className={`message-avatar ${message.role}`}>{message.role === "assistant" ? <Bot size={16} /> : <UserRound size={15} />}</span><div className="message-content"><div className="message-bubble">{message.text}</div>{message.source && <small className="message-source">{message.source} · not verified real financial data</small>}</div></div>)}
            {loading && <div className="chat-message assistant"><span className="message-avatar assistant"><Bot size={16} /></span><div className="typing-bubble"><i /><i /><i /></div></div>}
          </div>
          <div className="suggested-prompts"><span>Try asking</span><div>{suggestions.map((text) => <button key={text} onClick={() => submit(text)} disabled={loading}>{text}</button>)}</div></div>
          <form className="chat-input-area" onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Ask about your sample payments..." rows="1" /><button className="send-chat" type="submit" disabled={!question.trim() || loading} aria-label="Send message"><ArrowUp size={18} /></button><small>Demo responses only · never a substitute for verified financial information</small></form>
        </section>
      </div>
      <div className="assistant-actions"><span>Explore your demo workspace</span><a href="/leak-analysis">Analyze my transactions <ArrowUp size={14} /></a><a href="/route-optimizer">Compare payment routes <ArrowUp size={14} /></a><a href="/invoices">View overdue invoices ({overdue}) <ArrowUp size={14} /></a></div>
    </div>
  );
}
