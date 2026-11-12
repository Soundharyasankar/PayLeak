# PayLeak

PayLeak is a React application with a TypeScript/Express API for merchant
payment analysis, invoices, notifications, and account data.

## Run locally

1. Configure `backend/.env` using `backend/.env.example`. Set a reachable
   MongoDB Atlas URI and a unique `JWT_SECRET` of at least 32 characters.
2. Install dependencies and start both applications:

```powershell
npm install
npm install --prefix frontend
npm install --prefix backend
npm run dev
```

The frontend runs on Vite's local URL and the API listens on port 5000. Create
an account through **Create an account**; there are no demo credentials.
Passwords are hashed in MongoDB. The API returns the authenticated user and
sets an HTTP-only, 8-hour JWT cookie; the JWT is not exposed to browser
JavaScript.

For Atlas SRV DNS issues, set `MONGODB_DNS_SERVERS` to comma-separated resolver
IP addresses appropriate for your network. See
[`backend/.env.example`](./backend/.env.example).

## Current PayPal integration status

The API environment is explicit and host-validated: `sandbox` uses
`https://api-m.sandbox.paypal.com`, and an intentional `live` configuration
uses `https://api-m.paypal.com`. Never mix credentials and hosts. PayPal
Checkout remains Sandbox-only. The frontend Sandbox Checkout flow creates
orders on the backend, redirects the buyer to PayPal, and captures only after
server-side order verification. The backend stores confirmed captures in
MongoDB. No PayPal secrets belong in the frontend.
A real Sandbox credential, order-creation, and idempotency check passed, but
buyer approval and completed capture still require a separate Sandbox Personal
buyer account and have not been verified here.

Checkout testing does **not** link a merchant account. Seller-consent account
linking separate sellers requires an eligible PayPal partner application and
seller-consent permissions; `GET /api/paypal/connect` reports this as
unavailable, not connected. For one merchant, the backend uses that merchant's
REST app credentials and the designated PayLeak user configured through
`PAYPAL_ACCOUNT_OWNER_USER_ID`. An email address is not proof of ownership.
`POST /api/paypal/diagnostics` checks application OAuth and Transaction Search
API access separately without returning transaction contents or credentials.

On 2026-11-11, read-only Sandbox checks using the configured backend credentials
received HTTP 200 from OAuth, Transaction Search, and PayPal invoice listing.
The Transaction Search response reported six records for the tested date range;
the invoice list also returned an item. These checks verify API read access, not
MongoDB synchronization or invoice write/send operations. Repeat them after
changing credentials or PayPal app permissions. The authenticated Transactions
page reads stored records with server-side pagination, date/status/currency
filters, and per-transaction details.

An authenticated end-to-end Sandbox test on 2026-11-11 also synchronized PayPal
transactions through the backend route, verified seven owner-scoped records in
MongoDB, and submitted the latest seven transaction facts to Gemini through the
financial-agent route. The context included masked PayPal transaction identifiers, dates,
statuses, gross amounts, actual fees when available, and stored net verification
and conversion values. Six of the seven records had an actual recorded fee.
Payer names, payer emails, and client identities were excluded from this
account-wide AI prompt. Gemini generated a response that identified the data as
Sandbox test data. The assistant sends no more than the ten newest transaction
facts alongside currency-separated backend totals; detailed transaction
contents are not written to the AI-context telemetry log. Financial-agent
answers use Markdown headings, lists, and tables where appropriate, rendered as
safe text in the frontend.

Invoice creation, updating, sending, and synchronization are implemented using
the PayPal Invoicing API, but require the relevant permissions on the merchant's
Sandbox app. Invoice list/read access alone does not prove write or send access.
Reminder email and PayPal exchange-rate quote requests remain unavailable
without their separate provider integrations/permissions. Financial reports
preserve source currencies and do not invent missing fee or conversion values.

Overdue reminder drafts are persisted once per invoice, use the invoice's verified
client or recipient email, and can be reviewed in the Notifications page. Drafting does
not send email. The send endpoint remains unavailable until an email provider is
configured and confirms submission.

The AI Assistant provides client-specific analysis from owner-scoped client,
invoice, and PayPal transaction records, with currency-separated totals,
deterministic rankings for recorded revenue, fees, and outstanding invoices, and
authenticated downloadable client PDFs. The current schema has no project or
project-expense records, so complete net profit and project profitability are
explicitly marked undetermined. PDF reports require the configured Gemini
service for report insights and are stored with user-scoped metadata and
download authorization.

The AI Assistant's payment-history panel uses exact PayPal invoice references from
transactions to display a uniquely linked invoice's non-email client label and explicit
project name when available. PayPal item descriptions are shown separately as payment
details; they are not treated as project names or included in account-wide Gemini
context.

API contracts are documented in
[`docs/API_CONTRACTS.md`](./docs/API_CONTRACTS.md). Backend startup must
successfully connect to MongoDB before Express begins listening.

## Render deployment

The deployed frontend and API are separate Render services. Set
`VITE_API_BASE_URL` on the frontend Static Site to the API's HTTPS base URL,
including `/api` (for example, `https://payleak.onrender.com/api`). This is a
Vite build-time variable, so changing it requires a new frontend deployment.
Set the backend `FRONTEND_URL` to the exact public frontend origin
(for example, `https://payleak-1.onrender.com`), and set `NODE_ENV=production`.
The backend must use a stable `JWT_SECRET` of at least 32 characters across
deployments; rotating it invalidates existing sessions.

The frontend API client uses credentialed requests and the backend sets
an HTTP-only, Secure, SameSite=None, host-only `__Host-payleak_access` cookie
with the `Partitioned` attribute in production. This keeps the API session
partitioned to this frontend in browsers that block unpartitioned third-party
cookies. A prior unpartitioned `payleak_access` cookie is cleared during
login/registration and accepted only as a short migration fallback; new
sessions do not issue it. Modern browsers support partitioned cookies; older
browsers that block third-party cookies require a custom same-site domain or a
same-origin API proxy.

Keep CORS credential support enabled for the exact frontend origin; do not use
a wildcard origin. Render sets `NODE_ENV=production` for Node services; confirm
that the API service's `FRONTEND_URL` matches the frontend origin and that
`VITE_API_BASE_URL` points to the API service.

For session restoration on direct navigation or refresh, add this rewrite in
the frontend Static Site's Render Dashboard under **Redirects/Rewrites**:
`/*` → `/index.html` with action **Rewrite**. The domain root works without
this rule, but client-side paths such as `/login` otherwise return a static
404 on refresh.

After deployment, verify `https://<api-host>/api/health` and confirm that
`GET /api/auth/me` returns 401 without a session. Login and registration must
then establish a cookie that makes `/api/auth/me` return that user's profile.
The UI only marks the user authenticated after that server check succeeds.

## Vercel multi-service deployment

The root [`vercel.json`](./vercel.json) defines two services: the Vite frontend
and Express backend. Deploy from the repository root. Requests under `/api/`
are routed to the backend; all other paths are routed to the frontend. The
frontend uses the same-origin `/api` base path in production and Vite proxies
that path to `localhost:5000` during local development.

The backend service runs its TypeScript build and uses `src/app.ts` as its
Vercel Express entrypoint. Vercel's Express runtime supports TypeScript
entrypoints; the build artifact is emitted at `backend/dist/app.js` for the
normal Node.js start script. The Express app establishes a MongoDB connection
on demand before handling requests. Its normal local server still connects
before listening.

Configure backend environment variables in the Vercel project settings:
`MONGODB_URI`, `JWT_SECRET`, and `FRONTEND_URL` are required for deployment.
Set `FRONTEND_URL` to the canonical deployed application URL so PayPal return
links point to the deployed frontend. Configure `GEMINI_API_KEY` and the
appropriate PayPal credentials and mode for the integrations you intend to use.
Do not configure `VITE_API_BASE_URL` for the same-domain deployment unless
intentionally overriding `/api`.

The `ai-service/` directory contains prompt prototypes, not a separately
deployable runtime service. The active Gemini integration is part of the
backend. There are currently no Vercel service-to-service bindings.

## Project structure

- `frontend/` — React app, authenticated UI, and API services
- `backend/` — Express API, validation, models, and business logic
- `ai-service/` — AI prompt and extractor prototypes
- `docs/` — API and database documentation
- `tests/` — project-level test folder
