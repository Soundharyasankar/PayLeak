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
unavailable, not connected. For one merchant, the backend can use that
merchant's own REST app credentials only when PayPal grants Transaction Search
permission and an operator has verified and bound the designated PayLeak user
via immutable `PAYPAL_ACCOUNT_OWNER_USER_ID`. An email address is not proof of
ownership. `POST /api/paypal/diagnostics` checks application OAuth and the
Transaction Search permission separately without returning transaction
contents or credentials.

The current configured Sandbox app successfully obtains an OAuth app token,
but a real Transaction Search request returned HTTP 403. The Dashboard routes
users to the diagnostic/authorization page instead of implying Sync is ready.
Enable Transaction Search for that Sandbox REST app (or obtain the eligible
partner access required for third-party sellers) before syncing. The
authenticated Transactions page reads stored records with server-side
pagination, date/status/currency filters, and per-transaction details.

Invoice drafts are stored in MongoDB. PayPal invoice delivery, reminder email,
and exchange-rate quote requests remain explicitly unavailable until their
respective PayPal permissions or delivery integration are configured. Financial
reports preserve source currencies and do not invent missing fee or conversion
values.

The AI Assistant provides client-specific analysis from owner-scoped client,
invoice, and PayPal transaction records, with currency-separated totals,
deterministic rankings for recorded revenue, fees, and outstanding invoices, and
authenticated downloadable client PDFs. The current schema has no project or
project-expense records, so complete net profit and project profitability are
explicitly marked undetermined. PDF reports require the configured Gemini
service for report insights and are stored with user-scoped metadata and
download authorization.

API contracts are documented in
[`docs/API_CONTRACTS.md`](./docs/API_CONTRACTS.md). Backend startup must
successfully connect to MongoDB before Express begins listening.

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
