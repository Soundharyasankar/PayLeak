import { api, endpoints, isApiEnabled } from "./api.js";
import { getLeakTotals, money } from "../data/demoData.js";

export async function askAssistant(question, transactions) {
  if (!isApiEnabled) return getDemoAnswer(transactions);

  try {
    const response = await api.post(endpoints.chat, { question });
    return { text: response.data.answer, source: "Connected API" };
  } catch (error) {
    if (error.response) throw error;
    return getDemoAnswer(transactions);
  }
}

function getDemoAnswer(transactions) {
  const totals = getLeakTotals(transactions);
  const answer = `This is a demo-data explanation. Across ${transactions.length} sample transactions, the identified transaction fees total ${money(totals.fees)}, conversion differences total ${money(totals.conversion)}, and other known costs total ${money(totals.other)}. These are illustrative estimates, not verified PayPal records.`;
  return { text: answer, source: "Demo data" };
}
