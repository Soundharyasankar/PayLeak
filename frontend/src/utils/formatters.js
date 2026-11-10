export const money = (amount, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount) || 0);

export const getInvoiceTotals = (invoices) => ({
  total: invoices.length,
  paid: invoices.filter((invoice) => invoice.status === "Paid").length,
  pending: invoices.filter((invoice) => ["Draft", "Sent", "Partially Paid"].includes(invoice.status)).length,
  overdue: invoices.filter((invoice) => invoice.status === "Overdue").length,
});
