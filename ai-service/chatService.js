export function buildChatContext(question, context = {}) {
  return {
    instruction: "Answer using the supplied context only. State clearly when the context lacks the answer.",
    question: String(question),
    context,
  };
}
