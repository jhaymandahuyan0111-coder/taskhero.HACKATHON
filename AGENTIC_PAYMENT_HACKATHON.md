# Velo x Noir Agentic Payment Hackathon - TaskHero Implementation

## Overview
TaskHero implements an agentic payment flow on Stellar Testnet using Velo for gas sponsorship and Noir for on-chain agent policies and escrow.

## Build Requirements - Status

### Policy-gated, human-approved agent payment
- Frontend `AgentPayments` component in `src/App.jsx` provides:
  - Wallet connect via Freighter
  - Device registration → agent registration with per-payment cap
  - Escrow funding
  - Policy evaluation via Noir `checkPayment`
  - Authorize payment → merchant pending balance
  - Merchant claim flow
- The Noir policy decides whether a requested payment is allowed under the owner's on-chain rules. The user chooses the merchant and amount and explicitly signs an allowed payment.
- Anny's Ollama help chat is separate from the payment policy decision; do not describe Anny as approving or autonomously initiating payments.

### Velo Checkout and Gas Station
- Backend `package.json` includes `@carts1024/velo-sdk@^1.0.0`
- Backend `routes/payments.js` uses Velo Checkout for hosted XLM sessions and Velo Gas Station for signed Noir transactions.
- Endpoints:
  - `GET /api/payments/config`
  - `POST /api/payments/checkout-sessions`
  - `GET /api/payments/checkout-sessions/:operationId`
  - `POST /api/payments/webhook` (raw-body HMAC verification and delivery deduplication)
  - `POST /api/payments/noir/submit`
  - `POST /api/payments/noir/status`
- Checkout credentials (`VELO_API_KEY`, `VELO_WEBHOOK_SECRET`) are separate from Gas Station credentials (`VELO_GAS_API_KEY`, `VELO_GAS_BASE_URL`).
- The hosted checkout flow requires valid success and cancel URLs and a configured webhook secret. Live Testnet checkout and webhook delivery still need to be exercised with Velo project credentials.

### Noir Testnet contracts
Environment `backend/.env`:
```
NOIR_DEVICE_REGISTRY_CONTRACT=CAC4KOLHDLDYDWBOKXNKRN5KVHO56PLOIFXDLTBUWGVN6GVDEB7FQHU5
NOIR_AGENT_REGISTRY_CONTRACT=CCMZDSPTLX7IIJWCYEUM5DJUHOSOYSTHGK777S2TXZWEMC5ZZGPJ3EBV
NOIR_PAYMENT_ESCROW_CONTRACT=CC7EAW5FNJEDBS7THM5IT6XIOHO4AOYMLXT3KSZ3HWUIKEACTW7E5BFS
```
Allowed methods validated in `routes/payments.js`:
`register`, `revoke`, `register_agent`, `revoke_agent`, `fund_escrow`, `authorize`, `claim`, `defund_escrow`, `sweep_on_revoke`

Frontend uses `@noirx402/agent-sdk` `NoirAgentClient` for:
- `registerDevice`
- `registerAgent`
- `fundEscrow`
- `checkPayment`
- `authorize`
- `claim`
- Balance queries

### Velo + Noir integration
- Frontend signs transactions with Freighter, backend sponsors via Velo Gas Station
- Transaction validation ensures single `invokeContract` to allowlisted Noir contracts/methods
- Idempotency and correlation IDs used for Velo submissions

## Architecture

**Frontend**
- `src/App.jsx` → `AgentPayments` component
- `src/Ai chat bot/AiChatBot.jsx` → Anny assistant UI
- Dependencies: `@noirx402/agent-sdk`, `@stellar/freighter-api`, `@stellar/stellar-sdk`

**Backend**
- `backend/server.js` → Express server
- `backend/routes/payments.js` → Velo sponsorship + Noir validation
- `backend/routes/ai.js` → Anny Ollama proxy
- `backend/.env` → Velo API key and Noir contract IDs

## Flow
1. User signs in to TaskHero
2. Connect Stellar Testnet wallet
3. Register device hash → register agent with cap → fund escrow
4. Enter merchant address, amount, and reason → the Noir SDK evaluates the on-chain policy; Anny chat is separate
5. User approves → wallet signs `authorize` → Velo sponsors submission
6. Merchant can claim pending XLM → settled on Stellar Testnet
7. Separately, a signed-in user can create a hosted Velo XLM checkout, return to TaskHero, and retrieve payment status; Velo sends signed events to `/api/payments/webhook`.

## Registration
Project registration at https://velo-build.dev is required for hackathon submission. Provide project name, repo link, and demo.

## Notes
- Testnet only. Never use mainnet wallets.
- Velo Gas API key configured through the backend environment; value intentionally omitted.
- No completed Testnet transaction or hosted-checkout proof is recorded in this repository yet.
- AI assistant Anny uses Ollama model `gemma4:e2b`
