export function buildFinancialExplanationPrompt(financialData) {
  return [
    "Explain these payment costs in clear, neutral language.",
    "Do not invent figures or provide personalized financial advice.",
    "Payment data:",
    JSON.stringify(financialData),
  ].join("\n\n");
}

export function buildFinancialExplanationPrompt(financialData) {
  return [
    "Explain these payment costs in clear, neutral language.",
    "Do not invent figures or provide personalized financial advice.",
    "Payment data:",
    JSON.stringify(financialData),
  ].join("\n\n");
}
