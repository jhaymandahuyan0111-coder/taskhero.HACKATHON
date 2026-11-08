# Cloudflare deployment

Live URL: https://taskhero-kirbz.taskhero-frontend.workers.dev

The Worker serves Vite and legacy public pages. API routes run in a SQLite-backed
Durable Object named `primary`. Cloudflare Workers AI powers Anny through the `AI`
binding, without a runtime API token. Local Express development still works.

The hosted database starts fresh; it does not contain local accounts or tasks.
Register a new account online. Five deployment-check accounts are flagged as test
accounts and excluded from the public member directory, search and member total.
Reuse these existing accounts for live checks instead of creating extra accounts.

## Publish changes

Install root and backend dependencies, authenticate Wrangler (`npx wrangler login`),
then run `npm run deploy:cloudflare` from the project root. Keep the existing
`TASKHERO_SESSION_SECRET` Worker secret. Never publish backend/.env or the local DB.
Alternatively supply CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in your shell.

Do not upgrade the account to a paid plan when a free quota is reached. Free
Workers, Durable Object storage/requests and Workers AI each have usage limits.
Payment services require their own configuration and were not verified by this deployment.

The SQLite adapter and request-body decoder are Worker-only aliases. All API
requests must continue to use the single `primary` object; the current compatibility
layer is not designed for multiple database objects in the same isolate.
