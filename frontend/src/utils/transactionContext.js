function linkedInvoiceFor(transaction, invoices) {
  const reference = transaction.invoiceReference?.trim();
  if (!reference) return null;

  const paypalMatches = invoices.filter((invoice) => invoice.paypalId === reference);
  if (paypalMatches.length === 1) return paypalMatches[0];
  if (paypalMatches.length > 1) return null;

  const numberMatches = invoices.filter((invoice) => invoice.invoiceNumber === reference);
  return numberMatches.length === 1 ? numberMatches[0] : null;
}

function safeName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && !/^unknown (?:customer|payer)$/i.test(name) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(name)
    ? name
    : null;
}

export function buildRecentPaymentContext(transactions, invoices) {
  if (!Array.isArray(transactions) || !Array.isArray(invoices)) return [];

  return transactions.slice(0, 5).map((transaction) => {
    const invoice = linkedInvoiceFor(transaction, invoices);
    const invoiceClient = safeName(invoice?.client);
    const payerName = safeName(transaction.client);
    const projectName = typeof invoice?.project === "string" ? invoice.project.trim() : "";

    return {
      id: transaction.id,
      date: transaction.date,
      clientName: invoiceClient,
      payerName: invoiceClient ? null : payerName,
      projectName: projectName || null,
      paymentDetails: Array.isArray(transaction.itemDetails)
        ? transaction.itemDetails.filter((detail) => typeof detail === "string" && detail.trim()).slice(0, 5)
        : [],
    };
  });
}
