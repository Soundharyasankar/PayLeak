import { useEffect, useMemo, useState } from "react";
import { ArrowUp, Bot, CirclePlus, FileDown, MessageSquare, MoreHorizontal, Plus, Sparkles, Trash2, UserRound } from "lucide-react";
import toast from "react-hot-toast";
import PageHeader from "../components/PageHeader.jsx";
import MarkdownMessage from "../components/MarkdownMessage.jsx";
import { useAppData } from "../context/AppContext.jsx";
import { askFinancialAgent, createClientFinancialReport, downloadFinancialReport, fetchFinancialAgentClients, testAssistantConnection } from "../services/aiService.js";
import { buildRecentPaymentContext } from "../utils/transactionContext.js";

const generalSuggestions = [
  "Summarize my client financial performance.",
  "Which client has generated the highest net profit?",
  "Compare my top clients by recorded revenue.",
  "Show my total unpaid invoice amount.",
  "How much did I pay in transaction fees this month?",
];

function currencyAmounts(entries) {
  if (!entries?.length) return "Unavailable";
  return entries.map(({ currency, amount }) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount));
    } catch {
      return `${amount} ${currency}`;
    }
  }).join(" · ");
}

function maskedTransactionId(id) {
  const value = String(id ?? "").trim();
  return value.length > 8 ? `masked-${value.slice(-4)}` : "masked";
}

function RankingList({ title, ranking }) {
  if (!ranking?.length) return <p className="agent-data-note">{title}: no comparable recorded values.</p>;
  return <div className="agent-ranking"><b>{title}</b>{ranking.map((group) => (
    <div key={group.currency}><small>{group.currency}</small><ol>{group.clients.map((client) => <li key={client.clientName}>{client.clientName} · {currencyAmounts([{ currency: group.currency, amount: client.amount }])}</li>)}</ol></div>
  ))}</div>;
}

function FinancialSummary({ summary, reportClientId, onDownload, downloading }) {
  if (!summary?.amounts) return null;
  const isComparison = summary.type === "client_comparison" || summary.type === "selected_client_comparison";
  const isAccountSummary = summary.type === "business_summary";
  const hasClientAssociations = Array.isArray(summary.clients) && summary.clients.length > 0;
  return (
    <div className="agent-summary">
      <h3>{summary.client?.name ? `${summary.client.name} · financial summary` : isComparison ? "Client financial comparison" : isAccountSummary ? "Account financial summary" : "Business financial summary"}</h3>
      {isComparison && <p className="agent-data-note">Account totals are grouped by currency. Client and project comparisons are shown only when supported by linked financial details.</p>}
      <div className="agent-summary-grid">
        <div><small>Received gross revenue</small><b>{currencyAmounts(summary.amounts.grossRevenueReceived)}</b></div>
        <div><small>Recorded transaction fees</small><b>{currencyAmounts(summary.amounts.transactionFees)}</b></div>
        <div><small>After recorded transaction fees</small><b>{currencyAmounts(summary.amounts.amountAfterRecordedTransactionFees)}</b></div>
        <div><small>Recorded withdrawal fees</small><b>{currencyAmounts(summary.amounts.withdrawalFees)}</b></div>
        <div><small>Total recorded payment costs</small><b>{currencyAmounts(summary.amounts.recordedPaymentCosts)}</b></div>
        <div><small>Refunds / reversals</small><b>{currencyAmounts(summary.amounts.refundsAndReversals)}</b></div>
        <div><small>Outstanding invoices</small><b>{currencyAmounts(summary.amounts.outstandingInvoices)}</b></div>
        <div><small>Net profit</small><b>{summary.amounts.netProfit ? currencyAmounts(summary.amounts.netProfit) : "Not fully determined"}</b></div>
      </div>
      <p className="agent-data-note">Figures remain grouped by currency.</p>
      {isComparison && hasClientAssociations && <div className="agent-record-scroll"><table><thead><tr><th>Client</th><th>Transactions</th><th>Projects</th><th>Received revenue</th><th>Transaction fees</th><th>After transaction fees</th><th>Outstanding invoices</th><th>Net profit</th></tr></thead>
        <tbody>{summary.clients.slice(0, 20).map((client) => <tr key={client.clientId || client.clientName}>
          <td>{client.clientName}</td>
          <td>{client.counts.transactions} total · {client.counts.successfulTransactions} successful{client.transactionIds?.length > 0 && <details><summary>IDs</summary><ul>{client.transactionIds.map((id) => <li key={id}>{maskedTransactionId(id)}</li>)}</ul></details>}</td>
          <td>Not tracked</td>
          <td>{currencyAmounts(client.amounts.grossRevenueReceived)}</td>
          <td>{currencyAmounts(client.amounts.transactionFees)}</td>
          <td>{currencyAmounts(client.amounts.amountAfterRecordedTransactionFees)}</td>
          <td>{currencyAmounts(client.amounts.outstandingInvoices)}</td>
          <td>Not determined</td>
        </tr>)}</tbody>
      </table></div>}
      {isComparison && !hasClientAssociations && <p className="agent-data-note">Client and project comparisons aren't available from the information included in this analysis.</p>}
      {summary.rankings && hasClientAssociations && <div className="agent-rankings">
        <RankingList title="Highest recorded revenue (within currency)" ranking={summary.rankings.byRevenue} />
        <RankingList title="Highest transaction fees (within currency)" ranking={summary.rankings.byTransactionFees} />
        <RankingList title="Highest outstanding invoices (within currency)" ranking={summary.rankings.byOutstandingInvoices} />
        <p className="agent-data-note">Net profit ranking: not determined. {summary.rankings.netProfit.explanation}</p>
        <p className="agent-data-note">Project count ranking: not available. {summary.rankings.byProjectCount.explanation}</p>
      </div>}
      {summary.transactions?.length > 0 && (
        <details className="agent-records">
          <summary>Show recent linked transactions ({summary.transactions.length}{summary.transactions.length === 100 ? "+" : ""})</summary>
          <div className="agent-record-scroll">
            <table><thead><tr><th>Date</th><th>Transaction</th><th>Gross</th><th>Fee</th><th>PayPal net</th></tr></thead>
              <tbody>{summary.transactions.slice(0, 10).map((transaction) => <tr key={transaction.id}>
                <td>{new Date(transaction.date).toLocaleDateString()}</td>
                <td>{maskedTransactionId(transaction.id)}</td>
                <td>{currencyAmounts([{ currency: transaction.gross.currency, amount: transaction.gross.amount }])}</td>
                <td>{transaction.fee ? currencyAmounts([{ currency: transaction.fee.currency, amount: transaction.fee.amount }]) : "Unavailable"}</td>
                <td>{transaction.reportedNet ? currencyAmounts([{ currency: transaction.reportedNet.currency, amount: transaction.reportedNet.amount }]) : "Unavailable"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      {summary.invoices?.length > 0 && (
        <details className="agent-records">
          <summary>Show matched invoices ({summary.invoices.length}{summary.invoices.length === 100 ? "+" : ""})</summary>
          <div className="agent-record-scroll">
            <table><thead><tr><th>Invoice</th><th>Status</th><th>Amount</th><th>Paid</th><th>Due</th></tr></thead>
              <tbody>{summary.invoices.slice(0, 10).map((invoice) => <tr key={`${invoice.number}-${invoice.date}`}>
                <td>{invoice.number}</td><td>{invoice.status}</td>
                <td>{currencyAmounts([{ currency: invoice.currency, amount: invoice.amount }])}</td>
                <td>{currencyAmounts([{ currency: invoice.currency, amount: invoice.paidAmount }])}</td>
                <td>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      {summary.dataCompleteness?.notes?.map((note) => <p className="agent-data-note" key={note}>{note}</p>)}
      {reportClientId && <button className="button secondary agent-report-button" onClick={() => onDownload(reportClientId, summary.period)} disabled={downloading}>
        <FileDown size={15} /> {downloading ? "Generating report…" : "Download PDF Report"}
      </button>}
    </div>
  );
}

export default function AIAssistant() {
  const { transactions, invoices } = useAppData();
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [contextClientId, setContextClientId] = useState(null);
  const [reportInProgress, setReportInProgress] = useState("");
  const [clients, setClients] = useState([]);
  const [clientsError, setClientsError] = useState("");
  const paymentContext = useMemo(() => buildRecentPaymentContext(transactions, invoices), [transactions, invoices]);
  const suggestions = useMemo(() => [
    ...generalSuggestions,
    ...(clients[0] ? [
      `Analyse ${clients[0].name}'s financial records.`,
      `Generate a financial report for ${clients[0].name}.`,
    ] : []),
  ], [clients]);

  useEffect(() => {
    let active = true;
    fetchFinancialAgentClients()
      .then((result) => {
        if (active) setClients(Array.isArray(result) ? result : []);
      })
      .catch((error) => {
        if (!active) return;
        const message = error.response?.data?.error?.message || "Could not load your registered clients.";
        setClientsError(message);
      });
    return () => { active = false; };
  }, []);

  const submit = async (value = question, selectedClientId) => {
    const text = value.trim();
    if (!text || loading) return;
    const history = messages.slice(-12).map(({ role, text: messageText }) => ({
      role,
      text: messageText,
    }));
    setQuestion("");
    setMessages((current) => [...current, { role: "user", text }]);
    setLoading(true);
    setRequestError("");
    try {
      const answer = await askFinancialAgent(text, contextClientId, selectedClientId, history);
      setContextClientId(answer.reportClientId || null);
      setMessages((current) => [...current, {
        role: "assistant",
        text: answer.answer,
        source: answer.source,
        summary: answer.summary,
        reportClientId: answer.reportClientId,
        ambiguousClients: answer.ambiguousClients || [],
        originalQuestion: text,
      }]);
    } catch (error) {
      const message = error.response?.data?.error?.message || "The assistant could not answer. Please try again.";
      setRequestError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const testConnection = async () => {
    if (checkingConnection) return;
    setCheckingConnection(true);
    try {
      const diagnostics = await testAssistantConnection();
      setConnectionStatus(diagnostics.connected);
      if (diagnostics.connected) toast.success(`Connected to Google Gemini (${diagnostics.model}).`);
      else toast.error("Add GEMINI_API_KEY to the backend environment to enable the assistant.");
    } catch (error) {
      setConnectionStatus(false);
      const message = error.response?.data?.error?.message || "Could not verify the Google Gemini connection. Please try again.";
      setRequestError(message);
      toast.error(message);
    } finally {
      setCheckingConnection(false);
    }
  };

  const downloadReport = async (clientId, period) => {
    if (!clientId || reportInProgress) return;
    setReportInProgress(clientId);
    try {
      const report = await createClientFinancialReport(clientId, period);
      await downloadFinancialReport(report.id, report.fileName);
      toast.success("Your client financial report is ready.");
    } catch (error) {
      const message = error.response?.data?.error?.message || "Could not generate the financial report.";
      setRequestError(message);
      toast.error(message);
    } finally {
      setReportInProgress("");
    }
  };

  const selectAmbiguousClient = (client) => {
    void submit(`Analyse ${client.name}'s financial records.`, client.id);
  };

  const clear = () => {
    setMessages([]);
    setRequestError("");
    setContextClientId(null);
  };

  return (
    <div className="page-enter">
      <PageHeader eyebrow="PAYLEAK INTELLIGENCE" title="AI Client Financial Intelligence" description="Ask about your clients, invoices, PayPal transactions, and recorded financial performance." />
      <div className="chat-layout">
        <aside className="chat-history">
          <div className="history-heading"><b>Conversations</b><button className="icon-button" onClick={clear} aria-label="Clear conversation"><Plus size={17} /></button></div>
          <button className="new-chat-button" onClick={clear}><CirclePlus size={16} /> New conversation</button>
          <span className="history-date">CURRENT SESSION</span>
          <button className="history-item active"><MessageSquare size={15} /><span>Financial questions</span><MoreHorizontal size={15} /></button>
          <span className="history-date">PAYMENT HISTORY</span>
          <div className="history-context">
            <b>Recent payment details</b>
            {paymentContext.length === 0
              ? <small>PayPal payment details aren't available yet.</small>
              : <ul className="history-payments">{paymentContext.map((payment) => (
                <li key={payment.id}>
                  <strong>{payment.clientName
                    ? `Client: ${payment.clientName}`
                    : payment.payerName
                      ? `PayPal payer: ${payment.payerName}`
                      : "Client name not included"}</strong>
                  {payment.date && <small>{payment.date}</small>}
                  <small>{payment.projectName ? `Project: ${payment.projectName}` : "Project name not included with this payment."}</small>
                  {payment.paymentDetails.length > 0 && <small>Payment details: {payment.paymentDetails.join(" · ")}</small>}
                </li>
              ))}</ul>}
          </div>
          <div className="history-disclaimer"><Sparkles size={14} /> Answers use authenticated records; missing data is disclosed.</div>
        </aside>
        <section className="chat-panel">
          <header className="chat-header"><span className="assistant-avatar"><Bot size={19} /></span><div><b>PayLeak AI</b><small><i />{connectionStatus === true ? " Google Gemini connected" : connectionStatus === false ? " Google Gemini connection needs attention" : " Google Gemini · your account records"}</small></div><button className="chat-clear-button" onClick={testConnection} disabled={checkingConnection}>{checkingConnection ? "Testing…" : "Test connection"}</button><button className="chat-clear-button" onClick={clear}><Trash2 size={15} /> Clear conversation</button></header>
          <div className="chat-messages">
            {messages.length === 0 && <div className="chat-empty"><span className="assistant-avatar large"><Sparkles size={23} /></span><h2>What would you like to understand?</h2><p>Questions are answered using your account’s stored financial records.</p></div>}
            {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`chat-message ${message.role}`}><span className={`message-avatar ${message.role}`}>{message.role === "assistant" ? <Bot size={16} /> : <UserRound size={15} />}</span><div className="message-content"><div className="message-bubble">{message.role === "assistant" ? <MarkdownMessage text={message.text} /> : message.text}</div>
              {message.role === "assistant" && <FinancialSummary summary={message.summary} reportClientId={message.reportClientId} onDownload={downloadReport} downloading={reportInProgress === message.reportClientId} />}
              {message.ambiguousClients?.length > 0 && <div className="agent-client-choices">{message.ambiguousClients.map((client) => <button key={client.id} onClick={() => selectAmbiguousClient(client)} disabled={loading}>{client.name}{client.email ? ` · ${client.email}` : ""}</button>)}</div>}
            </div></div>)}
            {loading && <div className="chat-message assistant"><span className="message-avatar assistant"><Bot size={16} /></span><div className="typing-bubble"><i /><i /><i /></div></div>}
          </div>
          <div className="suggested-prompts"><span>Try asking</span><div>{suggestions.map((text) => <button key={text} onClick={() => submit(text)} disabled={loading}>{text}</button>)}</div></div>
          {clientsError && <p className="agent-client-load-error" role="status">{clientsError}</p>}
          <form className="chat-input-area" onSubmit={(event) => { event.preventDefault(); submit(); }}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Ask about your transactions…" rows="1" /><button className="send-chat" type="submit" disabled={!question.trim() || loading} aria-label="Send message"><ArrowUp size={18} /></button><small>{requestError || "Amounts in different currencies are not added together."}</small></form>
        </section>
      </div>
    </div>
  );
}
