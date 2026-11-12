# API contracts

Base URL: `/api`. Successful JSON responses use `{ "success": true, "data": ... }`.
Errors use `{ "success": false, "error": { "code": "...", "message": "..." } }`.
Authenticated browser requests use the HTTP-only JWT cookie. In production,
`__Host-payleak_access` is Secure, SameSite=None, and Partitioned. The legacy
`payleak_access` cookie is cleared during login/registration and accepted only
as a migration fallback. Both names are host-only and expire after eight
hours. API clients may also supply a JWT in the `Authorization` header. Health,
registration, login, logout, and PayPal webhook endpoints do not require an
existing user session; `/auth/me` and other protected endpoints do.
The browser verifies the cookie with `GET /auth/me` after login or registration
before marking the account authenticated. A 401 on a protected request clears
the frontend session; a 403 keeps the session and reports insufficient access.
The access cookie expires after eight hours; the API does not issue refresh
tokens, so the user must sign in again after expiration.
Monetary amounts are decimal strings. The API does not substitute estimated
fees or rates.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API and MongoDB availability, including active database name when connected |
| POST | `/auth/register` | Register a user, set the HTTP-only session cookie, and return the user |
| POST | `/auth/login` | Authenticate, set the HTTP-only session cookie, and return the user |
| GET | `/auth/me` | Return the authenticated user's profile |
| PUT | `/auth/me` | Update the authenticated user's name and email |
| POST | `/auth/logout` | Clear the HTTP-only session cookie |
| GET | `/paypal/connect` | Currently reports unavailable until an approved partner integration is configured |
| GET | `/paypal/config` | Report configured environment and whether Sandbox Checkout credentials are configured; no secrets returned |
| GET | `/paypal/account` | Get the authenticated user's stored PayPal account status |
| POST | `/paypal/diagnostics` | Check whether PayPal transaction synchronization is available; returns a minimal status only |
| POST | `/paypal/sync` | Sync configured owner's PayPal Transaction Search data; returns a minimal completion status |
| POST | `/paypal/orders` | Create an idempotent Sandbox Checkout order |
| POST | `/paypal/orders/:orderId/capture` | Verify buyer approval, capture server-side, and save the completed capture in MongoDB |
| POST | `/paypal/orders/:orderId/cancel` | Verify order state and record cancellation only for a PayPal-voided order |
| POST | `/paypal/webhook` | Verify and persist a PayPal webhook event |
| GET | `/transactions` | List the authenticated user's transactions (paginated/filterable) |
| POST | `/transactions/sync` | Sync PayPal transactions for the configured owner |
| GET | `/transactions/:id` | Get one transaction |
| POST | `/transactions/:id/refresh` | Refresh one transaction from PayPal Transaction Search and upsert the returned record |
| GET | `/transactions/:id/fee-breakdown` | Get actual fee details or report unavailable |
| GET | `/transactions/:id/currency-breakdown` | Get currency conversion and payout details |
| GET | `/analytics/transactions/:transactionId/ai-analysis` | Return PayPal-reported gross, fee, net, conversion, and payout values separately from deterministic PayLeak calculations, verification status, discrepancy reasons, and a cached transaction-specific Gemini explanation; authenticated and rate-limited. Add `?regenerate=true` to request a fresh explanation |
| GET | `/clients` | List the user's clients |
| POST | `/clients` | Create a client |
| GET | `/clients/:id` | Get one client |
| PUT | `/clients/:id` | Update a client |
| DELETE | `/clients/:id` | Delete a client |
| GET | `/invoices` | List the user's invoices |
| GET | `/invoices/currencies` | List ISO currencies recognized by the server runtime and their precision rules; PayPal confirms invoicing availability on create |
| POST | `/invoices/assistant` | Send a natural-language invoice turn and receive schema-validated draft updates plus the next required-field question |
| POST | `/invoices/local-draft` | Idempotently persist a completed local draft using `assistantSessionId` before PayPal synchronization |
| POST | `/invoices` | Create a PayPal Sandbox draft first, then save the confirmed invoice for the authenticated merchant owner |
| POST | `/invoices/paypal/diagnostics` | Verify PayPal invoice API access; returns only an authorized/unavailable status |
| POST | `/invoices/sync-paypal` | Retrieve and sync PayPal invoices for the configured owner; returns a minimal completion status |
| POST | `/invoices/:id/paypal` | Create an existing local draft in PayPal and link the confirmed PayPal invoice to that same MongoDB record |
| GET | `/invoices/:id` | Get one invoice |
| PUT | `/invoices/:id` | Update an invoice |
| DELETE | `/invoices/:id` | Delete only an unsent local PayLeak draft; ownership, source, status, and PayPal linkage are checked atomically |
| POST | `/invoices/:id/send` | Send a PayPal-confirmed draft and update local status only after PayPal confirms sending |
| GET | `/analytics` | Currency-separated dashboard metrics |
| GET | `/analytics/dashboard` | Dashboard metrics (alias) |
| GET | `/analytics/monthly` | Monthly gross totals by currency |
| GET | `/analytics/fees` | Verified actual fees grouped by currency |
| GET | `/analytics/clients` | Client metrics grouped by currency |
| GET | `/analytics/currencies` | Gross totals by currency |
| GET | `/analytics/leaks` | Actual fee and unavailable conversion/withdrawal details |
| GET | `/analytics/leaks/:transactionId` | Fee and currency breakdown for one transaction |
| GET | `/currency/paypal/rates` | List stored PayPal exchange-rate records |
| GET | `/currency/paypal/rates/:from/:to` | Get a stored PayPal rate |
| POST | `/currency/paypal/quote` | Currently unavailable; no quote is fabricated |
| POST | `/currency/paypal/calculate` | Calculate using an existing verified PayPal quote |
| GET | `/currency/paypal/fees` | List effective-dated verified fee schedules |
| GET | `/currency/paypal/conversions/:id` | Get a stored conversion |
| GET | `/notifications` | List the user's notifications |
| PATCH | `/notifications/read-all` | Mark all notifications read |
| PATCH | `/notifications/:id` | Set a notification's read state |
| DELETE | `/notifications/:id` | Delete a notification |
| POST | `/notifications/reminders/:invoiceId/draft` | Save or return the single active reminder draft for an overdue invoice; requires an accessible MongoDB invoice `_id` and valid invoice/client recipient email; never sends email |
| POST | `/notifications/reminders/:invoiceId/send` | Currently unavailable; verifies invoice access and a saved draft, then returns an explicit error without sending |
| POST | `/ai/chat` | Ask the AI to explain stored financial data |
| POST | `/ai/assistant` | AI chat alias |
| POST | `/ai/financial-agent` | Resolve an authenticated client, calculate client or business summaries from owned client/invoice/transaction records, then generate a grounded answer; account-wide analysis includes up to ten newest transaction facts without payer identity or client identifiers; accepts optional `contextClientId`, `selectedClientId`, `periodStart`, and `periodEnd` |
| POST | `/ai/reports/client` | Generate a client financial PDF, store its metadata and document in MongoDB, and return a report ID; body accepts `clientId` and optional period bounds |
| GET | `/ai/reports/:reportId/download` | Download a generated PDF after verifying report ownership |
| POST | `/ai/diagnostics` | Test Google Gemini key availability, model, and API connectivity without returning credentials |

Reminder drafts are stored separately from notifications and are unique per invoice
while in `draft` status. The reminder endpoint uses the same invoice access scope as
invoice listing: the authenticated user's invoices plus PayPal invoices in the
configured shared integration. It looks up the MongoDB invoice `_id` (the frontend's
`invoice.id`), not the PayPal invoice ID. A linked client is resolved using both its
MongoDB `_id` and the invoice owner's `userId`; the recipient is taken from that
verified client record or the recipient email saved on the invoice. Invalid or missing
recipients fail before a draft is stored. The active-draft unique index and atomic
upsert make repeat clicks and retries return the existing draft instead of creating
duplicates. Sending is not configured; a draft is not represented as sent or delivered.

Transaction analysis uses only fields returned by PayPal Transaction Search and PayLeak's
deterministic decimal calculation. A calculated net is available only for a non-refund
transaction when the actual PayPal gross and fee use the same currency. Verification
statuses are `MATCH`, `MISMATCH`, `NOT_AVAILABLE`, or `NOT_APPLICABLE`; a PayPal refresh
updates the selected transaction from Transaction Search and does not infer a bank payout.

The authenticated Transactions API view also exposes a PayPal invoice reference and
sanitized transaction item descriptions when present. The AI Assistant's payment-history
panel matches that reference only to a unique invoice belonging to the authenticated
account. It displays the linked invoice's client label only when it is not an email
address, and shows an invoice project only when one is explicitly present. PayPal item
descriptions are labeled as payment details, not inferred project names. These labels
remain in the authenticated UI and are not added to account-wide Gemini context.

The client financial agent uses deterministic backend calculations before requesting
an AI explanation. Account-wide prompts include at most the ten newest owner-scoped
MongoDB transactions with a masked PayPal transaction identifier, date, status, gross,
actual fee, reported net, calculated net, and available conversion facts. Payer names, payer emails,
client names, and client IDs are excluded from this account-wide prompt. Gemini receives
only that bounded transaction slice and currency-separated backend totals, not invoice
or client identity records. The response identifies Sandbox data as test data when the
configured PayPal environment is Sandbox. The backend logs the Gemini model, environment,
and number of transaction records included without logging transaction contents. The
financial-agent answer is returned as Markdown and the frontend renders headings, lists,
and tables as text without interpreting raw HTML.
It associates transactions by stored client ID or exact registered
client email, and falls back to an exact unique payer-name match only when PayPal
provides no payer email; an explicit client ID always takes precedence. Analysis
reuses the owner-scoped transaction retrieval service used by the Transactions API
and deduplicates PayPal transaction IDs. Account-wide totals are calculated
directly from all owner-scoped transactions and invoices, including transactions
that cannot safely be associated with a registered client; client rankings use
only safely associated records. Retrieval failures return an explicit error and
are logged with a masked owner identifier and record counts. Received payment
totals come only from successful PayPal transactions; invoices are shown
separately and never added to received revenue. Amounts remain grouped by
currency. The summary distinguishes gross receipts after recorded transaction
fees from net profit. Client net profit and project profitability are marked
unavailable because this installation has no project or project-expense models.
Transactions may have an optional registered `clientId`; invoices may have an optional
`clientId` and a free-form project string. The transaction schema has no normalized
invoice relation, but PayPal's raw transaction response may contain an invoice
identifier; the payment-history panel uses an exact, unique match to an owned invoice
for display only. There is no project entity, so a project is shown only when the linked
invoice explicitly provides one. The account-wide agent does not infer a client or
project from a payer label or transaction description.
Generated PDFs are stored with user ownership metadata and downloaded through
the authenticated route; creation and download are rate-limited.

AI chat accepts `{ "question": "...", "history": [{ "role": "user|assistant", "text": "..." }] }`.
The backend fetches transactions, invoices, and currency conversions using the
authenticated user's ID and sends financial facts plus recent conversation turns
to Google Gemini; transaction IDs are masked and account-wide invoice customer names
and email addresses are omitted. Conversation history is kept in the current frontend session and
is not stored in MongoDB. Set `GEMINI_API_KEY` and `GEMINI_MODEL` in the backend
environment (`gemini-3.5-flash-lite` by default; `gemini-2.5-flash` was not
available to this AI Studio key when verified). Diagnostics makes a minimal Gemini
request and returns provider, model, and connectivity status; it never returns the
API key.

Transaction AI analysis reads only the authenticated user's stored PayPal
transaction record. PayLeak calculates same-currency net-after-fee and fee
percentage using decimal arithmetic; Gemini only produces explanatory text,
insights, and recommendations and is not allowed to provide financial amounts.
Payer names are omitted from the LLM prompt; only whether payer identity is
available is included. Missing exchange-rate benchmarks, withdrawal records,
and bank settlement data remain unavailable rather than being estimated. Pass
`?regenerate=true` to request a fresh explanation.

`POST /paypal/orders` requires an `Idempotency-Key` UUID header and a validated
amount, currency, and description. The browser redirects the buyer to PayPal's
Sandbox approval page; the backend verifies the completed order/capture before
inserting its capture as a transaction. Merchant seller-consent linking is a
separate capability and remains unavailable without PayPal partner approval.
The API requires `PAYPAL_MODE=sandbox` with
`https://api-m.sandbox.paypal.com`, or the explicit `PAYPAL_MODE=live` with
`https://api-m.paypal.com`. The Checkout flow remains Sandbox-only.
Transaction Search uses the merchant's own REST app only after its permissions
are granted and a verified, immutable PayLeak owner user ID is configured.
Email matching is not an ownership proof. Connecting separate merchants
requires eligible PayPal partner seller-consent access; app client credentials
alone do not supply that authorization.

Direct PayPal invoice creation requires an authenticated user matching
`PAYPAL_ACCOUNT_OWNER_USER_ID`, Sandbox app credentials, and a UUID
`Idempotency-Key` header. Itemized invoices send each validated line item in
the selected currency; PayLeak calculates the total from those amounts using
decimal arithmetic. The API reports PayPal success only after PayPal returns a
confirmed draft with an invoice ID and status. Reuse the same idempotency key
after a timeout.

`GET /invoices/currencies` provides ISO currency codes recognized by the server
runtime and their fraction-digit rules for validation and the creation form.
This list does not guarantee availability for the Invoicing API, a particular
merchant, or an environment: PayPal's actual create response is authoritative.
PayLeak never converts an amount or substitutes another currency when PayPal
rejects the requested code. The amount must respect that currency's precision.
The create form requires an explicit currency and shows the selected code in
its preview.

The conversational invoice flow sends the complete user turn, current structured
draft including priced line items, and recent turns to the configured Gemini
provider through the authenticated `POST /invoices/assistant` route. The response
is schema-validated, merged without discarding previously collected fields, and
checked for required invoice fields. Backend decimal arithmetic calculates item
totals and due dates.
The browser keeps only the active conversation in component state; navigating
away and returning starts a fresh conversation. Saved invoices remain available
from the invoice list. Once complete, it automatically persists a PayLeak draft
through `POST /invoices/local-draft`; retries with the same `assistantSessionId`
return that same record. It then links the draft to PayPal with the existing
idempotent `POST /invoices/:id/paypal` operation. PayPal failures leave the local
draft available for retry and editing, even if an earlier PayPal request has an
unresolved request ID. Editing a local draft only updates PayLeak and clears the
stale PayPal request ID; editing an already linked draft uses PayPal's update
operation and verifies the returned amount/currency. Invoice sending remains a
separate explicit user action.

`DELETE /invoices/:id` removes only an owned, unsent `source=payleak`,
`status=Draft` record with no linked PayPal invoice ID. A stale PayPal request
key does not prevent deletion. PayPal-linked, sent, paid, or otherwise finalized
invoices are retained; deleting a local record never cancels a PayPal invoice.

Previously saved local-only draft invoices remain identifiable as
`source=payleak`. `POST /invoices/:id/paypal` creates the remote draft and links
its PayPal identifiers to that same MongoDB document. The sync operation is
import-only; it never pushes local drafts or sends invoices. Sending is a
separate `POST /v2/invoicing/invoices/{invoice_id}/send` request. PayLeak only
updates the local status after PayPal confirms the result and refreshes invoice
details/status from PayPal. The local update endpoint cannot override a
PayPal-linked invoice's status.

Invoice diagnostics report OAuth scope claims separately from actual Invoicing
API access. They do not create or send a test invoice; those mutating operations
can only be verified by a real operation. PayPal client-credentials does not
identify the merchant, so confirm the REST app's Sandbox Business association
in PayPal Developer Dashboard.

Postman Sandbox workflow:
1. Sign in with `POST /api/auth/login` and retain the HTTP-only cookie (or set a
   bearer JWT). Use the backend base URL `http://localhost:5000/api`.
2. Call `POST /api/invoices/paypal/diagnostics` with `{}`. The response reports
   only whether invoice API access is authorized or unavailable. It does not
   verify invoice creation or sending permissions.
3. Call `POST /api/invoices` with a UUID `Idempotency-Key` header and a validated
   body, for example:
   `{ "client": "Sandbox Buyer", "email": "<Sandbox buyer email>", "amount": "10.00", "currency": "USD", "description": "Sandbox test service", "date": "2026-11-09", "due": "2026-11-16" }`.
   Success includes the PayPal invoice ID/number and confirmed status. On
   denial, inspect the sanitized PayPal error name, message, HTTP status, and
   debug ID; PayLeak does not create a local-only invoice.
4. To link an existing PayLeak-only draft, call
   `POST /api/invoices/{mongo_invoice_id}/paypal` with a UUID
   `Idempotency-Key`.
5. To send a confirmed draft, call
   `POST /api/invoices/{mongo_invoice_id}/send`. This emails the invoice to the
   Sandbox recipient; use only a Sandbox buyer address.
6. Call `POST /api/invoices/sync-paypal` twice. Each successful response
   contains only `{ "synchronized": true }`; use the invoice list to inspect
   imported records. Synchronization upserts by PayPal invoice ID, so repeating
   it does not create duplicates.
PayPal invoice import uses the separate Invoicing API
`GET /v2/invoicing/invoices?page=1&page_size=100&total_required=true`. The token's
reported OAuth scope claims are shown separately from observed API access,
because successful Invoicing API requests may succeed when a scope is not listed
in the OAuth response. It paginates all returned pages and upserts by authenticated `userId` plus PayPal
invoice ID. Import does not create invoices in PayPal or delete local invoices.
The sync endpoint returns only a completion status and does not expose
diagnostic metadata. Detailed diagnostics remain internal to the backend.
PayPal does not return the merchant identity for client-credentials
invoice-list requests; verify the REST app's Sandbox Business association in
the PayPal Developer Dashboard.
`POST /transactions/sync` accepts a date range of up to three years and queries
PayPal in consecutive 30-day windows, requesting `fields=all` and paging through
each response. Its successful result contains only `{ "synchronized": true }`;
detailed synchronization diagnostics remain internal to the backend. A
successful response confirms completion, not that the Sandbox account's
Developer Dashboard history matches the authorized REST app.

`GET /transactions` accepts `page`, `limit` (maximum 100), `from`, `to`,
`currency`, and `status` query parameters. Browser login/register responses do
not expose the JWT in JSON; the browser sends its HTTP-only cookie automatically.
Logout clears the cookie; there is no refresh-token system.
