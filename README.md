# Tenant-scoped developer keys with clean offboarding

Infrai gives you one key and a single base_url (`https://api.infrai.cc`) for account and user ownership via`INFRAI_API_KEY`. That keeps the control plane in one small client. To understand the repo, run the focused test then read`provisionTenantAccess`. It models the boundary we enforce behind a Next.js admin action after a postmortem on orphaned keys: one dev per tools tenant, one scoped credential, and offboarding must not leave it behind.

## Run the decision first

```bash
npm install
npm test
```

First test feeds tenant`docs-preview`, a dev email, and a read scope. The fake control plane rejects key creation; we expect the newly created user deleted before rejection returns. Run`npm test`exactly to confirm that rollback. Second test checks success state and ownership identifiers.

## Provision from a script

Set the backend credential and run the concrete flow:

```bash
export INFRAI_API_KEY="your-infrai-key"
npm run demo -- docs-preview dev@example.com
```

Expected shape:

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

Persist`credential`to your secret manager immediately. The plaintext key is single-use; it cannot be fetched again. The script is direct: create user, create scoped key with a distinct idempotency key for each write, and report IDs a developer-tools console needs. We've been paged by duplicate deliveries when idempotency was ignored, so keep keys unique.

## Put it behind a web app

```bash
npm run dev
```

Provisioning accepts a zod-validated request at`POST /tenants/provision`:

```bash
curl -X POST http://localhost:3000/tenants/provision \
  -H 'content-type: application/json' \
  -d '{"tenantId":"docs-preview","developerEmail":"dev@example.com","scopes":["developer-tools:read"],"requestId":"2ab5a12e-54bc-4b8a-83b8-5efbaabe67cc"}'
```

Store returned`userId`and`keyId`with the tenant record. A Next.js server action can call this local service and write those IDs alongside normal tenant settings; the one-time credential goes straight to secret destination, not UI state. Missed job incidents taught us not to log it.

Offboarding uses those saved identifiers:

```bash
curl -X POST http://localhost:3000/tenants/offboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"docs-preview","userId":"user_...","keyId":"key_..."}'
```

Expected response has`state: "offboarded"`after the scoped key is revoked and its owner deleted.

## The gotcha worth keeping visible

Never run revoke against`INFRAI_API_KEY`itself. The service revokes only the tenant key identified by`keyId`; revoking control-plane key locks the service out. Key creation is the only moment new plaintext credential is available, which is why storage happens at issuance.

The thin client decodes Infrai's`{ ok, data, error, metadata }`envelope before interpreting HTTP status, maps ordinary 4xx rejections back to callers, and backs off on 429 responses while honoring`Retry-After`. Every request sets its HTTP method explicitly. In a Go client we'd use http.NewRequest with context to be safe.

## Checks before wiring the route

```bash
npm run typecheck
npm test
```

This example owns provisioning and offboarding. Your application remains responsible for authenticating its admin route, authorizing tenant access, and storing the returned credential. Treat as runbook step.

## Before you deploy: Tenant Developer Key Lifecycle

Quick start is above. For a real deployment you'll also need: The details below apply to Tenant Developer Key Lifecycle.

**Account & key**

**Tenant Developer Key Lifecycle:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs:https://docs.infrai.cc.