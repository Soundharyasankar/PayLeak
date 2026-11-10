export function createEmptyInvoiceAgent() {
  return {
    sessionId: crypto.randomUUID(),
    paypalRequestId: crypto.randomUUID(),
    draft: {
      client: "",
      email: "",
      project: "",
      services: [],
      lineItems: [],
      amount: "",
      currency: "",
      description: "",
      date: new Date().toISOString().slice(0, 10),
      due: "",
    },
    messages: [],
    invoice: null,
    paypalError: "",
  };
}

export function invoicePayloadFromDraft(draft) {
  return {
    client: draft.client,
    email: draft.email,
    project: draft.project || "",
    services: draft.services || [],
    amount: String(draft.amount),
    currency: draft.currency,
    description: draft.description,
    date: draft.date,
    due: draft.due,
    ...(Array.isArray(draft.lineItems) && draft.lineItems.length > 0
      ? { lineItems: draft.lineItems.map((item) => ({
        description: item.description,
        amount: String(item.amount),
      })) }
      : {}),
  };
}

export function buildInvoiceAssistantRequest(message, draft = {}, history = []) {
  const optionalFields = [
    "client",
    "email",
    "amount",
    "currency",
    "project",
    "description",
    "date",
    "due",
  ];
  const normalizedDraft = Object.fromEntries(
    optionalFields
      .filter((field) => typeof draft[field] === "string" && draft[field].trim() !== "")
      .map((field) => [field, draft[field].trim()]),
  );
  if (Array.isArray(draft.services) && draft.services.length > 0) {
    normalizedDraft.services = draft.services.filter((service) => typeof service === "string" && service.trim() !== "");
  }
  if (Array.isArray(draft.lineItems) && draft.lineItems.length > 0) {
    normalizedDraft.lineItems = draft.lineItems
      .filter((item) => item && typeof item.description === "string" && typeof item.amount === "string")
      .map(({ description, amount }) => ({ description: description.trim(), amount: amount.trim() }));
  }

  return {
    message: message.trim(),
    draft: normalizedDraft,
    history: history
      .filter((turn) => turn && ["user", "assistant"].includes(turn.role) && typeof turn.text === "string" && turn.text.trim() !== "")
      .slice(-12)
      .map(({ role, text }) => ({ role, text: text.trim() })),
  };
}
