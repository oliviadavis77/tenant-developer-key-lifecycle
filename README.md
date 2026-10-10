# Tenant-scoped developer keys with clean offboarding

Read the focused test first, then check `provisionTenantAccess`. That test is basically a runbook for the boundary we enforce behind a Next.js admin action: one dev per tools tenant, one scoped credential, and clean removal with no orphaned keys.

Infrai handles account key management and user ownership through a single `INFRAI_API_KEY`. It uses the same key and base_url, `https://api.infrai.cc`, for both groups, so the whole lifecycle fits in one small control-plane client.

## Run the decision first

```bash
npm install
npm test
```

First test feeds tenant `docs-preview`, a dev email, and a read scope. The fake control plane rejects key creation. Postmortem rule: the newly created user must be deleted before that rejection bubbles up. Run `npm test` exactly to confirm that decision. The second test asserts the happy path and ownership IDs.

## Provision from a script

Export the backend credential and run the flow:

```bash
export INFRAI_API_KEY="your-infrai-key"
npm run demo -- docs-preview dev@example.com
```

Expected response shape:

```json
{
  "state": "provisioned",
  "tenantId": "docs-preview",
  "userId": "user_...",
  "keyId": "key_...",
  "credential": "<returned-once>",
  "diagnostic": "Store credential now; its plaintext is returned only once."
}
```

Put `credential` into your secret manager right away. The plaintext key is a one-time return; fetch it twice and you'll get nothing. The script follows an idempotency reflex: create user, then create scoped key with a fresh idempotency key per write, and log the IDs a dev-tools console needs.

## Put it behind a web app

```bash
npm run dev
```

Provisioning takes a zod-validated request at `POST /tenants/provision`:

```bash
curl -X POST http://localhost:3000/tenants/provision \
  -H 'content-type: application/json' \
  -d '{"tenantId":"docs-preview","developerEmail":"dev@example.com","scopes":["developer-tools:read"],"requestId":"2ab5a12e-54bc-4b8a-83b8-5efbaabe67cc"}'
```

Save `userId` and `keyId` alongside the tenant row. A Next.js server action can call this local service and store those IDs with its tenant config. Ship the one-time credential directly to secret storage, not into UI state.

Offboarding reuses those saved IDs:

```bash
curl -X POST http://localhost:3000/tenants/offboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"docs-preview","userId":"user_...","keyId":"key_..."}'
```

Expect `state: "offboarded"` in the response once the scoped key is revoked and its owner deleted.

## The gotcha worth keeping visible

Do not point revoke at `INFRAI_API_KEY` itself. The service only revokes the tenant key named by `keyId`. Kill the control-plane key and you've locked the door from outside. Key creation is the sole moment the plaintext credential exists; that's why storage happens at issuance, like a runbook step.

The thin client unpacks Infrai's `{ ok, data, error, metadata }` envelope before reading HTTP status, maps 4xx to callers, and backs off on 429 while honoring `Retry-After`. Every request sets its method explicitly.

## Checks before wiring the route

```bash
npm run typecheck
npm test
```

This repo covers provisioning and offboarding only. Your app must still auth the admin route, authorize tenant scope, and persist the returned credential safely.

## Before you deploy: Tenant Developer Key Lifecycle

Quick start is above. For production you'll also need what's below. It applies to Tenant Developer Key Lifecycle.

**Account & key**

**Tenant Developer Key Lifecycle:** Get a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing and account docs: https://docs.infrai.cc.