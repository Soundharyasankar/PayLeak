import { Invoice } from "../models/Invoice.js";

const invoiceIndexName = "userId_1_paypalInvoiceId_1_paypal_unique";
let indexSetup: Promise<void> | undefined;
let assistantIndexSetup: Promise<void> | undefined;

export async function ensurePaypalInvoiceIndex() {
  if (!indexSetup) {
    indexSetup = (async () => {
      const indexes = await Invoice.collection.indexes().catch((error: unknown) => {
        if (error && typeof error === "object" && "code" in error && error.code === 26) return [];
        throw error;
      });
      const legacyIndex = indexes.find((index) =>
        index.name === "userId_1_paypalInvoiceId_1"
        && index.unique === true
        && index.sparse === true
        && !index.partialFilterExpression
      );
      if (legacyIndex?.name) {
        await Invoice.collection.dropIndex(legacyIndex.name);
      }
      await Invoice.collection.createIndex(
        { userId: 1, paypalInvoiceId: 1 },
        {
          unique: true,
          partialFilterExpression: { paypalInvoiceId: { $type: "string" } },
          name: invoiceIndexName,
        },
      );
    })().catch((error: unknown) => {
      indexSetup = undefined;
      throw error;
    });
  }
  await indexSetup;
}

export async function ensureAssistantInvoiceIndex() {
  if (!assistantIndexSetup) {
    assistantIndexSetup = Invoice.collection.createIndex(
      { userId: 1, assistantSessionId: 1 },
      {
        unique: true,
        partialFilterExpression: { assistantSessionId: { $type: "string" } },
        name: "userId_1_assistantSessionId_1_unique",
      },
    ).then(() => undefined).catch((error: unknown) => {
      assistantIndexSetup = undefined;
      throw error;
    });
  }
  await assistantIndexSetup;
}
