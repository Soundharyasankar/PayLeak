export const demoTransactions = [
  { id: "TXN-80241", client: "Northstar Studio", gross: 2400, fee: 87.6, currency: "USD", net: 2312.4, date: "2026-11-06", status: "Completed", otherFees: 0, actualRate: 82.4, referenceRate: 84.1, referenceSource: "Demo reference rate", referenceTime: "2026-11-06 10:30 UTC" },
  { id: "TXN-80238", client: "Mira Chen", gross: 1250, fee: 48.13, currency: "USD", net: 1201.87, date: "2026-11-03", status: "Completed", otherFees: 0, actualRate: 82.7, referenceRate: 84.2, referenceSource: "Demo reference rate", referenceTime: "2026-11-03 14:00 UTC" },
  { id: "TXN-80233", client: "Brightline Media", gross: 980, fee: 38.71, currency: "EUR", net: 941.29, date: "2026-10-27", status: "Completed", otherFees: 0, actualRate: 89.2, referenceRate: 91.0, referenceSource: "Demo reference rate", referenceTime: "2026-10-27 09:00 UTC" },
  { id: "TXN-80229", client: "Studio Koto", gross: 3100, fee: 112.3, currency: "USD", net: 2987.7, date: "2026-10-12", status: "Completed", otherFees: 3.5, actualRate: 82.1, referenceRate: 84.15, referenceSource: "Demo reference rate", referenceTime: "2026-10-12 11:15 UTC" },
  { id: "TXN-80215", client: "Owen & Co.", gross: 760, fee: 30.14, currency: "GBP", net: 729.86, date: "2026-09-09", status: "Completed", otherFees: 0, actualRate: 104.2, referenceRate: 106.0, referenceSource: "Demo reference rate", referenceTime: "2026-09-09 16:00 UTC" },
  { id: "TXN-80208", client: "Aster Labs", gross: 1800, fee: 66.9, currency: "USD", net: 1733.1, date: "2026-08-27", status: "Completed", otherFees: 0, actualRate: 82.6, referenceRate: 84.1, referenceSource: "Demo reference rate", referenceTime: "2026-08-27 08:45 UTC" },
  { id: "TXN-80194", client: "Leah Patel", gross: 540, fee: 22.36, currency: "EUR", net: 517.64, date: "2026-08-04", status: "Completed", otherFees: 0, actualRate: 88.9, referenceRate: 90.7, referenceSource: "Demo reference rate", referenceTime: "2026-08-04 12:00 UTC" },
  { id: "TXN-80180", client: "Form & Function", gross: 2100, fee: 77.4, currency: "USD", net: 2022.6, date: "2026-07-02", status: "Completed", otherFees: 2, actualRate: 82.3, referenceRate: 84, referenceSource: "Demo reference rate", referenceTime: "2026-07-02 10:00 UTC" },
  { id: "TXN-80162", client: "Juniper Digital", gross: 1450, fee: 55.1, currency: "USD", net: 1394.9, date: "2026-06-26", status: "Completed", otherFees: 0, actualRate: 82.8, referenceRate: 84.3, referenceSource: "Demo reference rate", referenceTime: "2026-06-26 13:30 UTC" },
  { id: "TXN-80151", client: "Marco Ruiz", gross: 1320, fee: 50.16, currency: "GBP", net: 1269.84, date: "2026-06-22", status: "Completed", otherFees: 0, actualRate: 103.8, referenceRate: 105.6, referenceSource: "Demo reference rate", referenceTime: "2026-06-22 15:10 UTC" },
];

export const demoInvoices = [
  { id: "INV-2026-041", client: "Northstar Studio", email: "accounts@northstar.example", amount: 2400, currency: "USD", date: "2026-10-22", due: "2026-11-05", status: "Paid", description: "Brand identity and design system" },
  { id: "INV-2026-040", client: "Mira Chen", email: "mira.chen@example.test", amount: 1250, currency: "USD", date: "2026-10-02", due: "2026-10-16", status: "Overdue", description: "Product design sprint" },
  { id: "INV-2026-039", client: "Brightline Media", email: "finance@brightline.example", amount: 980, currency: "EUR", date: "2026-09-27", due: "2026-10-11", status: "Overdue", description: "Campaign landing page" },
  { id: "INV-2026-038", client: "Studio Koto", email: "hello@studiokoto.example", amount: 3100, currency: "USD", date: "2026-11-02", due: "2026-11-16", status: "Sent", description: "Website redesign milestone" },
  { id: "INV-2026-037", client: "Owen & Co.", email: "owen@example.test", amount: 760, currency: "GBP", date: "2026-09-05", due: "2026-09-19", status: "Overdue", description: "Editorial illustration package" },
  { id: "INV-2026-036", client: "Aster Labs", email: "ap@asterlabs.example", amount: 1800, currency: "USD", date: "2026-11-04", due: "2026-11-18", status: "Draft", description: "Prototype development" },
];

export const demoNotifications = [
  { id: 1, category: "Invoice", title: "Invoice INV-2026-040 is overdue", body: "Mira Chen · $1,250.00 USD · due Oct 16", time: "12 min ago", unread: true },
  { id: 2, category: "Financial alert", title: "Higher conversion cost detected", body: "Demo estimates show a 1.7% rate difference on TXN-80241.", time: "1 hour ago", unread: true },
  { id: 3, category: "AI recommendation", title: "Compare withdrawal routes", body: "Review route estimates before your next conversion.", time: "Yesterday", unread: true },
  { id: 4, category: "Payment", title: "Payment received from Northstar Studio", body: "Invoice INV-2026-041 · $2,400.00 USD", time: "Yesterday", unread: false },
  { id: 5, category: "Invoice", title: "Invoice INV-2026-039 is overdue", body: "Brightline Media · €980.00 EUR · due Oct 11", time: "Oct 11", unread: false },
  { id: 6, category: "Payment", title: "Payment completed", body: "TXN-80238 · $1,250.00 USD", time: "Nov 3", unread: false },
];

const usdRates = { USD: 1, EUR: 1.08, GBP: 1.27, INR: 0.012 };

export function getEarningsByMonth(transactions) {
  const monthNames = ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];
  const months = new Map(monthNames.map((month) => [month, { month, gross: 0, net: 0 }]));
  transactions.forEach((transaction) => {
    const date = new Date(`${transaction.date}T12:00:00`);
    const month = date.toLocaleString("en-US", { month: "short" });
    const totals = months.get(month);
    if (!totals) return;
    const usdRate = usdRates[transaction.currency] || 1;
    totals.gross += transaction.gross * usdRate;
    totals.net += transaction.net * usdRate;
  });
  return [...months.values()];
}

export const money = (amount, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);

export const getInvoiceTotals = (invoices) => ({
  total: invoices.length,
  paid: invoices.filter((invoice) => invoice.status === "Paid").length,
  pending: invoices.filter((invoice) => ["Draft", "Sent"].includes(invoice.status)).length,
  overdue: invoices.filter((invoice) => invoice.status === "Overdue").length,
});

export const getLeakTotals = (transactions) =>
  transactions.reduce(
    (totals, transaction) => ({
      fees: totals.fees + transaction.fee * (usdRates[transaction.currency] || 1),
      conversion: totals.conversion + Math.max(0, (transaction.gross - transaction.fee) * (transaction.referenceRate - transaction.actualRate) / 83.2),
      other: totals.other + transaction.otherFees * (usdRates[transaction.currency] || 1),
    }),
    { fees: 0, conversion: 0, other: 0 },
  );
