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

function validateInvoiceDescriptions(draft) {
  if (typeof draft.description === "string" && draft.description.length > 2000) {
    throw new Error("The invoice description must be 2,000 characters or fewer.");
  }
  if (Array.isArray(draft.services)) {
    if (draft.services.length > 30) throw new Error("An invoice can include at most 30 services.");
    if (draft.services.some((service) => typeof service !== "string" || service.trim().length > 200)) {
      throw new Error("Each service description must be 200 characters or fewer.");
    }
  }
  if (Array.isArray(draft.lineItems)) {
    if (draft.lineItems.length > 30) throw new Error("An invoice can include at most 30 line items.");
    if (draft.lineItems.some((item) => !item
      || typeof item.description !== "string"
      || !item.description.trim()
      || item.description.trim().length > 200)) {
      throw new Error("Each line-item description must be between 1 and 200 characters.");
    }
  }
}

export function invoicePayloadFromDraft(draft) {
  const payload = {
    client: draft.client,
    email: draft.email,
    project: draft.project || "",
    services: (draft.services || [])
      .filter((service) => typeof service === "string" && service.trim() !== "")
      .map((service) => service.trim()),
    amount: String(draft.amount),
    currency: draft.currency,
    description: draft.description,
    date: draft.date,
    due: draft.due,
    ...(Array.isArray(draft.lineItems) && draft.lineItems.length > 0
      ? { lineItems: draft.lineItems.map((item) => ({
        description: typeof item.description === "string" ? item.description.trim() : item.description,
        amount: String(item.amount),
      })) }
      : {}),
  };
  validateInvoiceDescriptions(payload);
  return payload;
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
    normalizedDraft.services = draft.services
      .filter((service) => typeof service === "string" && service.trim() !== "")
      .map((service) => service.trim());
  }
  if (Array.isArray(draft.lineItems) && draft.lineItems.length > 0) {
    normalizedDraft.lineItems = draft.lineItems
      .filter((item) => item && typeof item.description === "string" && typeof item.amount === "string")
      .map(({ description, amount }) => ({ description: description.trim(), amount: amount.trim() }));
  }

  validateInvoiceDescriptions(normalizedDraft);
  return {
    message: message.trim(),
    draft: normalizedDraft,
    history: history
      .filter((turn) => turn && ["user", "assistant"].includes(turn.role) && typeof turn.text === "string" && turn.text.trim() !== "")
      .slice(-12)
      .map(({ role, text }) => ({ role, text: text.trim() })),
  };
}
