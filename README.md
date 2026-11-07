# TaskHero

**One-line pitch:** A task marketplace with owner-defined, Noir-enforced Testnet spending rules and a separate Velo-hosted checkout flow.

**Live website:** [TaskHero on Render](https://task-hero-bu79.onrender.com) (returned HTTP 503 during this review; availability must be rechecked before submission)  
**Public repository:** [github.com/kibberus/Task-Hero](https://github.com/kibberus/Task-Hero)  
**Demo video:** Pending publication.  
**Pitch deck:** Pending publication.  
**Team:** Add registered member names and Discord handles before submission.

## Problem

Task marketplaces need a way to make small payments without giving an automated agent unrestricted access to a user's wallet. Builders also need payment state that comes from the ledger rather than a browser redirect.

## Solution

TaskHero combines a Stellar Testnet task marketplace with Noir spending policies and Velo payment infrastructure. An owner configures an agent, asset, per-payment limit, and escrow. The Noir contract policy decides whether a requested payment is allowed; the user reviews and signs the transaction with Freighter. Separately, TaskHero can create a Velo-hosted XLM checkout and retrieve its status from the backend.

Anny is a separate TaskHero help assistant. It does not approve payments or sign transactions.

## Agentic Payment Flow

1. The owner connects a Stellar Testnet wallet, registers a device and agent, sets a per-payment cap, and funds the Noir escrow.
2. The user enters a merchant address, amount, and reason. `NoirAgentClient.checkPayment` evaluates the on-chain policy and returns an allow or deny result.
3. If allowed, the user reviews the payment and explicitly signs the Noir authorization with Freighter. The backend submits the signed invocation through Velo Gas Station.
4. The merchant claims pending XLM from Noir escrow.

This is a constrained, policy-based agent flow with explicit human signing. It is not an autonomous wallet or a claim that the help chatbot decides payments.

## Noir Integration

- **SDK:** `@noirx402/agent-sdk` `^0.3.0`.
- **Deployed contracts:** `device_registry`, `agent_registry`, and `payment_escrow`; the configured Testnet IDs are listed in [AGENTIC_PAYMENT_HACKATHON.md](AGENTIC_PAYMENT_HACKATHON.md).
- **SDK methods:** `registerDevice`, `registerAgent`, `fundEscrow`, `checkPayment`, `authorize`, `claim`, and balance queries.
- **Server validation:** [backend/routes/payments.js](backend/routes/payments.js) accepts one signed Testnet contract invocation and restricts contract IDs and method names.
- **Frontend flow:** [src/App.jsx](src/App.jsx) prepares the transaction with the Noir SDK and requests an explicit Freighter signature.

## Velo Checkout

The hosted checkout flow creates a Velo Checkout session on the backend, redirects the user when Velo returns a checkout URL, and checks payment status through Velo's PaymentIntent API. Velo may return an intent before a URL is available; TaskHero persists that intent and lets the user refresh status instead of creating another attempt. The backend verifies incoming webhook signatures against the original raw request body and deduplicates deliveries using `x-velo-delivery`.

Checkout and Gas Station use separate credentials. Checkout requires `VELO_API_KEY`; webhook verification requires `VELO_WEBHOOK_SECRET`; Noir transaction sponsorship uses `VELO_GAS_API_KEY`.

## Velo Integration

- **SDK:** `@carts1024/velo-sdk` `^1.0.0` in [backend/package.json](backend/package.json).
- **Checkout:** The backend creates hosted Testnet XLM checkout sessions and retrieves PaymentIntent status.
- **Webhooks:** `/api/payments/webhook` verifies the raw-body HMAC signature and deduplicates deliveries by `x-velo-delivery`.
- **Gas Station:** The backend sponsors user-signed Noir invocations and checks submission status. This is separate from hosted Checkout.
- **Implementation:** [backend/routes/payments.js](backend/routes/payments.js) and [backend/server.js](backend/server.js).

## Architecture

- `src/App.jsx`: task browser, Noir agent controls, and Velo checkout UI.
- `src/Ai chat bot/AiChatBot.jsx`: separate Ollama-backed help chat.
- `backend/routes/payments.js`: checkout sessions, payment status, signed webhooks, and allowlisted Noir Gas submissions.
- `backend/db.js`: SQLite persistence for application data and checkout/webhook records.
- `backend/server.js`: Express API and static frontend host.

## Repository Structure

```text
src/                  React frontend and payment UI
src/Ai chat bot/      Anny help-chat UI
backend/routes/       Express API routes, including Velo and Noir
backend/db.js         SQLite schema and data access
js/                   Legacy-page API/auth helpers
css/                  Application styles
components/           Shared legacy navigation
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | API health |
| `GET` | `/api/payments/config` | Testnet and Velo configuration status |
| `POST` | `/api/payments/checkout-sessions` | Create an authenticated hosted checkout |
| `GET` | `/api/payments/checkout-sessions/:operationId` | Retrieve an owned checkout's current Velo status |
| `POST` | `/api/payments/webhook` | Verify and record Velo webhook deliveries |
| `POST` | `/api/payments/noir/submit` | Submit a signed allowlisted Noir Testnet invocation |
| `POST` | `/api/payments/noir/status` | Check a Gas Station submission status |

All payment endpoints except `/config` and the signature-verified webhook require a TaskHero session.

## Testnet Proof

No completed Testnet transaction or hosted-checkout proof is recorded in the repository yet. Add a Stellar Expert Testnet transaction link and a verified checkout/webhook example before submission. Never use Mainnet wallets or real funds.

## Run Locally

Use a handbook-supported Node.js runtime: `22.23.4`, `24.22.1`, or `26.12.1` and newer.

```powershell
npm install
npm --prefix backend install
Copy-Item backend/.env.example backend/.env
npm run dev
```

In a second terminal, start the API:

```powershell
npm --prefix backend start
```

Set the Testnet project keys, webhook secret, and callback URLs in `backend/.env`. Keep all credentials server-side and never commit `.env`.

## Environment Variables

See [`backend/.env.example`](backend/.env.example). Keep secret values server-side and out of Git.

| Variable | Purpose |
| --- | --- |
| `VELO_API_KEY` | Velo Testnet Checkout API key |
| `VELO_BASE_URL` | Optional Velo Checkout API origin |
| `VELO_WEBHOOK_SECRET` | Verify Velo webhook signatures |
| `VELO_CHECKOUT_SUCCESS_URL` | Checkout success return URL |
| `VELO_CHECKOUT_CANCEL_URL` | Checkout cancellation return URL |
| `VELO_GAS_API_KEY` | Separate Gas Station Testnet key for Noir submissions |
| `VELO_GAS_BASE_URL` | Gas Station API origin |
| `NOIR_DEVICE_REGISTRY_CONTRACT` | Deployed Noir device registry |
| `NOIR_AGENT_REGISTRY_CONTRACT` | Deployed Noir agent registry |
| `NOIR_PAYMENT_ESCROW_CONTRACT` | Deployed Noir payment escrow |
| `TASKHERO_SESSION_SECRET` | Production TaskHero bearer-session signing secret |
| `OLLAMA_URL` | Anny help-chat Ollama endpoint |

Set `VELO_CHECKOUT_SUCCESS_URL` and `VELO_CHECKOUT_CANCEL_URL` to the frontend callback URL for the environment. Configure Velo to send signed payment events to `/api/payments/webhook`.

## Build

```powershell
npm run build
```

## Screenshots

Add screenshots of the task browser, Noir policy flow, and hosted checkout/status result before submission.

## What's Next

- Configure separate Velo Testnet Checkout, webhook, and Gas Station credentials in the deployment environment.
- Exercise a hosted checkout through a verified `payment.succeeded` webhook.
- Complete a Noir Testnet payment and add its Stellar Expert transaction link under Testnet Proof.
- Verify the public deployment URL is available and replace the pending demo video, pitch deck, team, and screenshot entries.

## Credits

TaskHero uses the Noir Agent SDK, Stellar SDK and Freighter API, and the Velo Node SDK. Add any additional third-party code or design credits before submission.