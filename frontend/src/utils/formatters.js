export const money = (amount, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount) || 0);

export const getInvoiceTotals = (invoices) => ({
  total: invoices.length,
  paid: invoices.filter((invoice) => invoice.status === "Paid").length,
  pending: invoices.filter((invoice) => ["Draft", "Sent", "Partially Paid"].includes(invoice.status)).length,
  overdue: invoices.filter((invoice) => invoice.status === "Overdue").length,
});

const transactionStatusLabels = {
  S: "Completed",
  COMPLETED: "Completed",
  P: "Pending",
  PENDING: "Pending",
  V: "Reversed",
  REVERSED: "Reversed",
  D: "Denied",
  DENIED: "Denied",
  REFUNDED: "Refunded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const transactionStatusLabel = (status) =>
  transactionStatusLabels[String(status).toUpperCase()] || String(status || "Unknown");

const transactionTypeLabels = {
  T0006: "Express Checkout payment",
  T1900: "General account correction",
  PAYMENT_CAPTURE: "PayPal Checkout capture",
};

export const transactionTypeLabel = (type) =>
  transactionTypeLabels[String(type).toUpperCase()] || String(type || "Unknown");
