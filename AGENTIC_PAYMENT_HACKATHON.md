# Velo x Noir Agentic Payment Hackathon - TaskHero Implementation

## Overview
TaskHero implements an agentic payment flow on Stellar Testnet using Velo for gas sponsorship and Noir for on-chain agent policies and escrow.

## Build Requirements - Status

### ✅ An agentic payment: the agent decides, requests or makes the payment
- Frontend `AgentPayments` component in `src/App.jsx` provides:
  - Wallet connect via Freighter
  - Device registration → agent registration with per-payment cap
  - Escrow funding
  - Policy check via Noir `checkPayment`
  - Authorize payment → merchant pending balance
  - Merchant claim flow
- Agent decisions are enforced on-chain by Noir policy, not just UI.

### ✅ Built with Velo: `npm install @carts1024/velo-sdk`
- Backend `package.json` includes `@carts1024/velo-sdk@^1.0.0`
- Backend `routes/payments.js` uses Velo Gas Station to sponsor and submit signed Noir transactions
- Endpoints:
  - `GET /api/payments/config`
  - `POST /api/payments/noir/submit`
  - `POST /api/payments/noir/status`
- Velo client initialized with `VELO_GAS_API_KEY` and `VELO_GAS_BASE_URL`

### ✅ Interacts with latest Noir Testnet contracts
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

### ✅ Velo + Noir integration
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
4. Enter merchant address, amount, note → Anny checks Noir policy
5. User approves → wallet signs `authorize` → Velo sponsors submission
6. Merchant can claim pending XLM → settled on Stellar Testnet

## Registration
Project registration at https://velo-build.dev is required for hackathon submission. Provide project name, repo link, and demo.

## Notes
- Testnet only. Never use mainnet wallets.
- Velo Gas API key present: `tg_test_8ef65c25ada028998b762a997cf751d6`
- AI assistant Anny uses Ollama model `gemma4:e2b`
