# PayLeak — Cross-Border Payment Intelligence Platform

PayLeak is an AI-powered payment intelligence and invoice management platform built with React, Vite, Tailwind CSS, Node.js, Express, TypeScript, and MongoDB. It identifies hidden fees, foreign exchange (FX) markup leaks, and optimizes cross-border merchant transaction routes through PayPal.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Environment Configuration (.env Guide)](#environment-configuration-env-guide)
  - [Backend Environment Variables (`backend/.env`)](#1-backend-environment-variables-backendenv)
  - [Frontend Environment Variables (`frontend/.env`)](#2-frontend-environment-variables-frontendenv)
  - [How to Obtain Your Credentials](#how-to-obtain-your-credentials)
    - [1. PayPal Sandbox API Credentials](#1-paypal-sandbox-api-credentials)
    - [2. PayPal Sandbox Test Accounts (Merchant & Buyer)](#2-paypal-sandbox-test-accounts-merchant--buyer)
    - [3. MongoDB Connection String](#3-mongodb-connection-string)
    - [4. Generating a Secure JWT Secret](#4-generating-a-secure-jwt-secret)
    - [5. Google Gemini API Key](#5-google-gemini-api-key)
  - [Verifying Your Configuration](#verifying-your-configuration)
- [PayPal Integration Status & Architecture](#paypal-integration-status--architecture)
- [Project Structure](#project-structure)
- [Testing & Quality Assurance](#testing--quality-assurance)

---

## Quick Start

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **MongoDB**: Local MongoDB daemon running on port 27017 or a MongoDB Atlas URI

### 2. Installation & Setup

Clone the repository and install root and package dependencies:

```powershell
# Clone your fork
git clone https://github.com/LOKESHvarma06/PayLeak.git
cd PayLeak

# Install dependencies
npm install
npm install --prefix frontend
npm install --prefix backend
```

### 3. Configure Environment Variables

Create the `.env` configuration files for both the backend and frontend:

```powershell
# Backend configuration
Copy-Item backend/.env.example backend/.env

# Frontend configuration
Copy-Item frontend/.env.example frontend/.env
```
*(On Linux/macOS, use `cp backend/.env.example backend/.env` and `cp frontend/.env.example frontend/.env`)*

Fill in your sandbox credentials in `backend/.env` (see the [Environment Configuration Guide](#environment-configuration-env-guide) below).

### 4. Run the Application

Start both the backend and frontend concurrently:

```powershell
npm run dev
```

- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **API Server**: [http://localhost:5000](http://localhost:5000)
- **API Health Check**: [http://localhost:5000/api/health](http://localhost:5000/api/health)

Register a new account via the UI (**Create an account**). Passwords are automatically hashed with bcrypt, and session authorization uses secure, HTTP-only JWT cookies.

---

## Environment Configuration (.env Guide)

> **Security Guardrail**: PayLeak operates strictly in **Sandbox** mode. Never use live PayPal production credentials or live endpoints. `.env` files are gitignored and must never be committed to source control.

---

### 1. Backend Environment Variables (`backend/.env`)

The backend configuration file lives at `backend/.env`. An example template is provided in [`backend/.env.example`](./backend/.env.example).

| Variable | Required | Default / Example | Description |
| :--- | :---: | :--- | :--- |
| `PORT` | Optional | `5000` | Port for Express API server to listen on. |
| `NODE_ENV` | Optional | `development` | Application mode (`development`, `test`, `production`). |
| `MONGODB_URI` | **Required** | `mongodb://127.0.0.1:27017/payleak` | Connection URI for local MongoDB or MongoDB Atlas cluster. |
| `MONGODB_DNS_SERVERS` | Optional | `8.8.8.8,8.8.4.4` | Comma-separated DNS resolver IPs to resolve Atlas SRV records if network DNS fails. |
| `JWT_SECRET` | **Required** | *32+ character random secret* | Cryptographic key used to sign and verify session JWTs. |
| `FRONTEND_URL` | **Required** | `http://localhost:5173` | Origin URL of the React frontend used for CORS policy. |
| `PAYPAL_MODE` | **Required** | `sandbox` | Target environment. Must be `sandbox`. |
| `PAYPAL_BASE_URL` | **Required** | `https://api-m.sandbox.paypal.com` | Base URL for PayPal REST API. |
| `PAYPAL_CLIENT_ID` | **Required** | `your_sandbox_client_id` | OAuth Client ID from PayPal Developer Dashboard. |
| `PAYPAL_CLIENT_SECRET`| **Required** | `your_sandbox_client_secret` | OAuth Client Secret from PayPal Developer Dashboard. |
| `PAYPAL_BUSINESS_EMAIL`| Optional | `merchant@business.example.com` | Primary sandbox merchant/business account email. |
| `PAYPAL_BUYER_EMAIL` | Optional | `buyer@personal.example.com` | Sandbox personal buyer account email for test checkouts. |
| `PAYPAL_BUYER_PASSWORD`| Optional | `your_buyer_password` | Sandbox personal buyer password for automated checkout flows. |
| `PAYPAL_WEBHOOK_ID` | Optional | `WH-XXXXXXXXXX` | Webhook identifier registered in PayPal Dashboard for signature verification. |
| `PAYPAL_ACCOUNT_OWNER_USER_ID` | Optional | `user_mongo_object_id` | Optional override to lock PayPal merchant credentials to a specific user ID. |
| `GEMINI_API_KEY` | Optional | `AIzaSy...` | Google Gemini API key for AI fee leakage analysis and chat recommendations. |
| `GEMINI_MODEL` | Optional | `gemini-3.5-flash-lite` | Gemini model name used for analysis extraction and cost insights. |

#### Complete `backend/.env` Example

```env
# Server & Runtime
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://127.0.0.1:27017/payleak
MONGODB_DNS_SERVERS=8.8.8.8,8.8.4.4
JWT_SECRET=4f9b8c2e1d0a5f6e7b8c9d0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c
FRONTEND_URL=http://localhost:5173

# PayPal Sandbox REST App Credentials
PAYPAL_MODE=sandbox
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=AXXXXXXXXXXXXX-YYYYYYYYYYYYY
PAYPAL_CLIENT_SECRET=EZZZZZZZZZZZZ-WWWWWWWWWWWWW
PAYPAL_BUSINESS_EMAIL=merchant-test@business.example.com
PAYPAL_BUYER_EMAIL=buyer-test@personal.example.com
PAYPAL_BUYER_PASSWORD=TestPassword123!
PAYPAL_WEBHOOK_ID=
PAYPAL_ACCOUNT_OWNER_USER_ID=

# AI & LLM Service
GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere
GEMINI_MODEL=gemini-3.5-flash-lite
```

---

### 2. Frontend Environment Variables (`frontend/.env`)

The frontend configuration file lives at `frontend/.env`. A template is provided in [`frontend/.env.example`](./frontend/.env.example).

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `VITE_API_BASE_URL` | **Required** | `http://localhost:5000/api` | Base URL of the PayLeak Express API. All frontend queries point here. |

#### Complete `frontend/.env` Example

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

---

### How to Obtain Your Credentials

#### 1. PayPal Sandbox API Credentials

1. Go to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) and log in with your PayPal developer account.
2. In the dashboard, navigate to **Apps & Credentials**.
3. Toggle the switch at the top right to **Sandbox**.
4. Click **Create App** (or select your existing Sandbox app):
   - **App Name**: `PayLeak Sandbox App`
   - **App Type**: `Merchant`
   - **Sandbox Business Account**: Select your default sandbox business account.
5. Click **Create App**.
6. Copy the **Client ID** and click **Show** under **Secret** to copy your **Secret Key**.
7. Paste these values into `backend/.env`:
   ```env
   PAYPAL_CLIENT_ID=your_copied_client_id
   PAYPAL_CLIENT_SECRET=your_copied_secret
   ```

#### 2. PayPal Sandbox Test Accounts (Merchant & Buyer)

PayPal Sandbox creates test accounts automatically so you can simulate both sides of a transaction:

1. In the [Developer Dashboard](https://developer.paypal.com/dashboard/), navigate to **Testing Tools** > **Sandbox Accounts**.
2. You will see at least two default test accounts:
   - **Business Account** (`...-facilitator@...`): Used as the **Merchant**.
   - **Personal Account** (`...-buyer@...`): Used as the **Buyer**.
3. Click the three dots `...` next to each account and click **View/Edit Account**:
   - Note the **Email ID** and the **System Generated Password** (or reset it to a password you choose).
4. Paste these into `backend/.env`:
   ```env
   PAYPAL_BUSINESS_EMAIL=facilitator-email@business.example.com
   PAYPAL_BUYER_EMAIL=buyer-email@personal.example.com
   PAYPAL_BUYER_PASSWORD=YourBuyerAccountPassword
   ```

#### 3. MongoDB Connection String

PayLeak requires a MongoDB database to store user accounts, cached transactions, fee analytics, and invoice drafts:

- **Local MongoDB**: If running MongoDB locally, use:
  ```env
  MONGODB_URI=mongodb://127.0.0.1:27017/payleak
  ```
- **MongoDB Atlas (Cloud)**:
  1. Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
  2. Click **Connect** > **Drivers** (Node.js).
  3. Copy the connection string and replace `<password>` with your database user password:
     ```env
     MONGODB_URI=mongodb+srv://username:password@cluster0.mongodb.net/payleak?retryWrites=true&w=majority
     ```
  4. If your network has issues resolving SRV records, specify DNS servers:
     ```env
     MONGODB_DNS_SERVERS=8.8.8.8,8.8.4.4
     ```

#### 4. Generating a Secure JWT Secret

The `JWT_SECRET` must be at least 32 characters long. You can generate a cryptographically strong random key using one of the following commands:

- **PowerShell / Node.js**:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Bash / OpenSSL**:
  ```bash
  openssl rand -hex 32
  ```

Copy the generated 64-character string and paste it into `JWT_SECRET` in `backend/.env`.

#### 5. Google Gemini API Key

PayLeak uses Google Gemini AI to analyze transaction fee structures and provide actionable route-optimization advice:

1. Visit [Google AI Studio](https://aistudio.google.com/app/apikey).
2. Sign in with your Google account and click **Create API Key**.
3. Copy the API key and paste it into `backend/.env`:
   ```env
   GEMINI_API_KEY=AIzaSyYourGeneratedGeminiKey
   GEMINI_MODEL=gemini-3.5-flash-lite
   ```

---

### Verifying Your Configuration

Once your `.env` files are configured, you can verify everything is working properly:

#### 1. Backend Diagnostics
Run the backend tests to ensure environment parsing and logic validation pass:
```powershell
cd backend
npm test
```

#### 2. PayPal Connection Diagnostics
When the backend server is running (`npm run dev`), you can check your PayPal sandbox credentials:
```powershell
Invoke-RestMethod -Uri "http://localhost:5000/api/paypal/diagnostics" -Method POST
```
The endpoint validates:
- Sandbox endpoint host validation (`https://api-m.sandbox.paypal.com`).
- OAuth 2.0 token generation via PayPal Sandbox.
- Scope and permission capabilities (Orders API, Invoicing, Transaction Search).

---

## PayPal Integration Status & Architecture

1. **Host-Validated Environment**:
   - `sandbox` strictly targets `https://api-m.sandbox.paypal.com`.
   - Never mix credentials and hosts.
2. **Deterministic Financial Math**:
   - In accordance with engineering guardrails, all fee breakdowns, FX spreads, and route comparisons are calculated with fixed-point decimal arithmetic.
3. **Resilient Sandbox Fallbacks**:
   - Because developer REST apps in Sandbox frequently have restricted permissions for reporting search and invoicing delivery, PayLeak includes automatic fallbacks.
   - User workspaces are pre-seeded with sandbox transactions and clients upon account creation, enabling end-to-end testing of analytics, fee leakage charts, and invoice drafting without blocking on third-party permissions.

---

## Project Structure

```
payleak/
├── frontend/               # React + Vite client application
│   ├── src/
│   │   ├── components/     # UI components (charts, modals, layout)
│   │   ├── pages/          # Dashboard, Invoices, Transactions, Analytics
│   │   ├── services/       # API clients and query hooks
│   │   └── types/          # TypeScript interface definitions
│   ├── .env.example        # Example frontend configuration
│   └── package.json
├── backend/                # Express + TypeScript API server
│   ├── src/
│   │   ├── config/         # Environment variable validation & schemas
│   │   ├── controllers/    # Request controllers
│   │   ├── models/         # Mongoose schemas (User, Transaction, Invoice, etc.)
│   │   ├── routes/         # Express API route declarations
│   │   ├── services/       # PayPal SDK client, analytics, invoicing, seeding
│   │   └── utils/          # Currency, validation, and error helpers
│   ├── .env.example        # Example backend configuration
│   └── package.json
├── docs/                   # System architecture and API contract documentation
└── package.json            # Root workspace scripts
```

---

## Testing & Quality Assurance

To execute the test suite:

```powershell
# Run backend unit & integration tests
cd backend
npm test

# Run TypeScript compile validation
npx tsc --noEmit

# Run frontend build check
cd ../frontend
npm run build
```
