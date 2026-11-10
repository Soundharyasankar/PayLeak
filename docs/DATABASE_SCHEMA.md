# Database schema

The backend uses MongoDB through Mongoose and explicitly selects the `payleak`
database, regardless of whether the URI contains a database path. Every
user-owned record is queried with its `userId`; PayPal transaction
synchronization is restricted to the explicitly configured merchant owner.
Amounts and exchange rates are stored as decimal strings so financial
arithmetic does not depend on binary floating point.

## Active backend collections

- **User** — normalized unique email, display name, and password hash.
- **Client** — user-owned client contact details.
- **Invoice** — user-owned local or PayPal-imported invoice; includes customer,
  project and service descriptions, priced `lineItems` (description and decimal
  amount), invoice number, amount/currency, subtotal/tax,
  invoice and due dates, payment details, source, status, and optional unique
  PayPal invoice and conversational assistant session identifiers.
  PayPal imports are upserted by `(userId, paypalInvoiceId)`; local drafts do
  not participate in that unique index. Conversational draft retries upsert by
  `(userId, assistantSessionId)` so retries cannot create duplicate local drafts.
  For itemized invoices, `amount` is recalculated from validated `lineItems`
  using decimal arithmetic; older/non-itemized records retain their stored total.
- **Transaction** — user owner, PayPal transaction ID, gross and actual fee
  amount/currency/source, conversion and payout fields, transaction date/status,
  retrieval timestamp, financial-data completeness, and retained raw PayPal
  payload. A unique index covers `(userId, paypalTransactionId)`.
- **PayPalAccount** — user owner, configured merchant identifiers/environment,
  verified capability flags, and last synchronization time.
- **PayPalOrder** — user owner, idempotency keys, Sandbox order/capture IDs,
  requested amount and currency, order state, and approval URL. Client secrets
  and buyer/card details are not stored.
- **PayPalExchangeRateQuote** — stored PayPal quote/rate records with direction,
  amount, currency, and source metadata.
- **CurrencyConversion** — conversion records referencing the quote/source and
  direction used.
- **FeeSchedule** — source and effective-dated fee information; no unverified
  schedule is seeded.
- **Notification** — user owner, category, content, read timestamp, and
  deduplication key.
- **FinancialReport** — user owner, optional client reference, report type,
  filename/content type, generation time and optional reporting period. PDF
  bytes are excluded from normal queries and only selected by the authenticated
  owner-scoped download route.
- **WebhookEvent** — PayPal event ID and verified event data for idempotent
  processing.

The legacy scaffold includes additional model files (for approvals, audit logs,
reference rates, and route quotes). They are not mounted into the current API
flow. Route optimization is not part of the current frontend experience.

There are currently no Project or ProjectExpense collections and no explicit
transaction-to-invoice foreign key. Client analysis uses stored client IDs and
exact email associations first, with an exact unique payer-name fallback only
when no payer email is available. It does not infer project profitability,
complete net profit, bank settlement, or conversion loss.
