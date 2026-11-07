# TaskHero Backend

Node.js + Express REST API for the TaskHero web app.

## Quick Start

```bash
cd backend
npm install
node server.js
```

Server runs at: **http://localhost:3000**

## Agent Payments (Stellar Testnet)

The TaskHero agent payment flow uses the Noir Testnet contracts for device registration, agent spending policy, escrow funding, payment authorization, and merchant claims. An authenticated backend route submits only a single signed invocation of an allowlisted Noir contract through the Velo Gas Station SDK. Wallet signing stays in the browser; this integration does not support Mainnet.

1. Register the project at [velo-build.dev](https://velo-build.dev) and configure an active Testnet Gas Station relayer that allows the three Noir Testnet contracts.
2. Create a **Gas Station · Testnet** API key and set `VELO_GAS_API_KEY` in the backend environment. See [`.env.example`](.env.example) for the current contract IDs and optional Velo API origin.
3. Install dependencies with `npm install` in both the project root and `backend/`, then restart the backend.
4. Sign in to TaskHero, connect Freighter on Stellar Testnet, register an agent, and fund its escrow with test XLM. Each Noir transaction requires an explicit wallet signature; Velo sponsors eligible network fees.

The returned Stellar transaction hash is the settlement proof. An authorized payment remains pending in Noir escrow until the merchant claims it. Testnet contracts are alpha and have not had a third-party audit; never use real funds.

For auto-restart on file changes:
```bash
npm run dev
```

## API Reference

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks (supports `?category=`, `?search=`, `?status=`, `?postedBy=`, `?acceptedBy=`) |
| GET | `/api/tasks/stats` | Home page stats |
| GET | `/api/tasks/:id` | Get one task |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id/accept` | Accept a task |
| PATCH | `/api/tasks/:id/complete` | Mark as completed |
| DELETE | `/api/tasks/:id` | Delete task |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users` | List all users |
| GET | `/api/users/search?q=` | Search users by name |
| GET | `/api/users/:id` | Get user + their tasks |
| GET | `/api/users/:id/follow-status?viewerId=` | Get follow relationship and counts |
| GET | `/api/users/:id/followers` | List followers |
| GET | `/api/users/:id/following` | List followed users |
| GET | `/api/users/:id/friends` | List mutual follows |
| POST | `/api/users/register` | Register new account |
| POST | `/api/users/login` | Login |
| PATCH | `/api/users/:id` | Update profile |
| POST | `/api/users/:id/follow` | Follow a user (session required) |
| DELETE | `/api/users/:id/follow` | Unfollow a user (session required) |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/messages/conversations/:userId` | Get conversation list |
| GET | `/api/messages/conversations/:userId/:convId` | Get messages in a conversation |
| POST | `/api/messages` | Send a message |
| POST | `/api/messages/conversations` | Start a new conversation |
| DELETE | `/api/messages/:messageId` | Hide a message for the requesting user |

### Notifications
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications/:userId` | Get notifications |
| PATCH | `/api/notifications/:userId/read-all` | Mark all as read |
| PATCH | `/api/notifications/:id/read` | Mark one as read |

### Reviews
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/reviews` | Create a review (session required) |
| GET | `/api/reviews/:userId` | List reviews for a user |

### AI assistant
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/chat` | Stream an Anny help-chat response as NDJSON |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/payments/config` | Report Testnet Checkout, webhook, and Gas Station configuration |
| POST | `/api/payments/checkout-sessions` | Create an authenticated Velo XLM PaymentIntent; `checkoutUrl` may be `null` while routing is pending |
| GET | `/api/payments/checkout-sessions/:operationId` | Retrieve the owner's current Velo PaymentIntent status |
| POST | `/api/payments/webhook` | Verify a Velo signature against the raw body and deduplicate deliveries |
| POST | `/api/payments/noir/submit` | Submit one signed allowlisted Noir Testnet invocation (session required) |
| POST | `/api/payments/noir/status` | Check a Velo Gas Station submission (session required) |

Authenticated routes require `Authorization: Bearer <session-token>`. The Velo webhook uses `x-velo-signature` and `x-velo-delivery` instead of a TaskHero session.

### Health Check
```
GET /api/health
```

## Example Requests

**Create a task:**
```json
POST /api/tasks
Authorization: Bearer <session-token>
{
  "title": "Help me move a sofa",
  "category": "Moving",
  "budget": 400,
  "location": "BGC, Taguig",
  "deadline": "2026-08-20",
  "description": "Need 2 people to help carry a sofa to the 3rd floor."
}
```

**Accept a task:**
```json
PATCH /api/tasks/task-seed-1/accept
Authorization: Bearer <session-token>
{}
```

**Send a message:**
```json
POST /api/messages
Authorization: Bearer <session-token>
{
  "conversationId": "conv-1",
  "text": "Hi! I'm interested in your task."
}
```

## Notes

- Application data is stored in SQLite at `backend/taskhero.db`.
- Passwords are hashed with `bcryptjs`; protected routes use signed bearer sessions.
- Set `TASKHERO_SESSION_SECRET` in production. The development fallback secret must not be used in production.
- See the repository-root README for the Velo checkout and Testnet submission flow.
