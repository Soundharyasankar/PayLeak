export function buildReminderPrompt(invoice) {
  return [
    "Write a concise, polite payment reminder using only the supplied invoice details.",
    "Do not claim that a payment is overdue unless the supplied data says so.",
    "Invoice:",
    JSON.stringify(invoice),
  ].join("\n\n");
}

export function buildReminderPrompt(invoice) {
  return [
    "Write a concise, polite payment reminder using only the supplied invoice details.",
    "Do not claim that a payment is overdue unless the supplied data says so.",
    "Invoice:",
    JSON.stringify(invoice),
  ].join("\n\n");
}
