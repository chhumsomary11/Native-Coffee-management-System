# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Node.js (CommonJS) microservices monorepo. There is no root `package.json`; each directory is an independent service with its own `package.json` and `node_modules`, and is run from inside that directory:

```
cd <service> && npm install
npm start        # node index.js
npm run dev      # node --watch index.js
npm test         # only register, report, staff: node --test test.js
node --test test.js --test-name-pattern="<name>"   # single test
```

Each service reads its own `.env` (git-ignored; only `api-gateway/.env.example` exists). `CoffeeManagement_All_Microservices.postman_collection.json` is the manual API test suite (expects the gateway on `localhost:4000`).

## Services and default ports

| Service | Port | Role |
| --- | --- | --- |
| api-gateway (`gateway.js`) | 3000 (`.env.example` sets 4000) | Only public entry point; JWT verification + role checks + proxying |
| register | 3001 | User accounts (owns writes to `users`); `seed-admin.js` seeds the first admin |
| login | 3002 | Verifies credentials, issues JWTs |
| menu | 3003 | Drinks |
| inventory | 3004 | Stock items; `/inventory/consume` and `/inventory/restore` are internal |
| order | 3005 | Orders; calls menu and inventory |
| payment | 3006 | Payments; calls order |
| staff | 3007 | Staff profiles and shifts; calls register |
| report | 3008 | Sales reports; calls order |

## Architecture notes (cross-file)

- **Gateway is the trust boundary** (`api-gateway/gateway.js`). It verifies the HS256 JWT, enforces role per route (`requireAdmin`, `requireAdminOrBarista`, etc.), strips any client-supplied `x-user-*`/`x-auth-*` headers, and injects trusted `x-user-id/name/email/role` headers. Routes are an explicit allowlist: **a new service endpoint is unreachable until you add a route to the gateway** (before the catch-all 404). Some endpoints are deliberately not exposed (e.g. `/orders/:id/payment-status`, `/inventory/consume`). Gateway requires every `*_SERVICE_URL` env var at startup.
- **Services trust gateway headers, not tokens.** Downstream services read `x-user-*` for identity (e.g. order filters customers to their own orders, staff `/staff/me` resolves by `x-user-id`). Service tests supply these headers directly.
- **Service-to-service calls** go through each service's `serviceClient.js` (order, payment, register, report, staff), using `fetch` with a timeout (`SERVICE_REQUEST_TIMEOUT_MS`, default 5000), a shared `x-internal-key` header (`INTERNAL_API_KEY`, must match across services), and forwarded identity headers. Downstream errors are mapped to a safe status set (400/403/404/409, otherwise 502). Services that accept internal calls check `x-internal-key` via a `requireInternalKey`-style middleware.
- **Order flow**: order fetches the drink from menu, calls inventory `consume`, and calls inventory `restore` to compensate if order creation fails afterward. Payment updates the order's payment status through a private order endpoint. Register and staff call each other (`STAFF_SERVICE_URL` / `REGISTRATION_SERVICE_URL`).
- **Data**: services use Mongoose and connect via `dbconnect.js` using `URI` (register/login use `db_password` to build an Atlas string for database `Coffee`, collection `users`, shared by register and login).
- **Naming quirk**: the JWT secret env var is intentionally spelled `JWT_SECRETE` and must be identical in gateway and login.
- **Test setup**: tests `require("./index.js")` and use exported `app`/models; they set `URI`, `INTERNAL_API_KEY`, and peer-service URLs in `process.env` before requiring (see `staff/test.js`). Services start listening only when run as the main module.

## Gotchas

- `login/package.json` `start`/`dev` run `authentication.js`; there is no `login/index.js` even though `architecture.md` mentions one. `architecture.md` is otherwise outdated (it only describes gateway/register/login); trust the code.
- `.kilo/` is tooling config, not application code.
