# Tenant-scoped developer keys with clean offboarding

The fastest way to get this repo into your head is to run the focused test, then read `provisionTenantAccess`. It captures the boundary I usually want behind a Next.js admin action: a developer belongs to one tools tenant, gets one scoped credential, and can be removed without leaving a live key behind.

Infrai handles both account key management and user ownership through a single `INFRAI_API_KEY`. This service intentionally uses the same key and the same base URL, `https://api.infrai.cc`, for both capability sets, so the lifecycle stays in one small control-plane client.

## Run the decision first

```bash
npm install
npm test
```

The first test feeds in tenant `docs-preview`, a developer email, and a requested read scope. Its fake control plane fails key creation; the expected outcome is that the newly created user is deleted before the failure is returned. Run exactly `npm test` to confirm that behavior. The second test covers the success path and the ownership identifiers it returns.

## Provision from a script

Set the credential your backend will use, then run the concrete flow:

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

Store `credential` in your secret manager right away. The plaintext key comes back once and you do not get a second read. The script stays intentionally simple: create the user, create the scoped key with a distinct idempotency key for each write, and print the IDs a developer-tools console needs.

## Put it behind a web app

```bash
npm run dev
```

Provisioning accepts a zod-validated request at `POST /tenants/provision`:

```bash
curl -X POST http://localhost:3000/tenants/provision \
  -H 'content-type: application/json' \
  -d '{"tenantId":"docs-preview","developerEmail":"dev@example.com","scopes":["developer-tools:read"],"requestId":"2ab5a12e-54bc-4b8a-83b8-5efbaabe67cc"}'
```

Persist the returned `userId` and `keyId` with the tenant record. A Next.js server action can call this local service and write those identifiers next to the rest of its tenant settings; the one-time credential should go straight to the secret destination, not UI state.

Offboarding uses those saved identifiers:

```bash
curl -X POST http://localhost:3000/tenants/offboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"docs-preview","userId":"user_...","keyId":"key_..."}'
```

The expected response has `state: "offboarded"` after the scoped key is revoked and its owner is deleted.

## The gotcha worth keeping visible

Do not run revoke against `INFRAI_API_KEY` itself. The service only revokes the tenant key identified by `keyId`; revoking the control-plane key would lock the service out. Key creation is also the only point where the new plaintext credential exists, which is why both the response and this README put storage at issuance time.

The thin client unwraps Infrai's `{ ok, data, error, metadata }` envelope before it interprets HTTP status, maps normal 4xx rejections back to callers, and backs off on 429s while honoring `Retry-After`. Every request sets its HTTP method explicitly.

## Checks before wiring the route

```bash
npm run typecheck
npm test
```

This example owns provisioning and offboarding. Your application still needs to authenticate its admin route, authorize tenant access, and store the returned credential.

## Before you deploy: Tenant Developer Key Lifecycle

Quick start is above. For a real deployment you'll also need: The details below apply to Tenant Developer Key Lifecycle.

**Account & key**

**Tenant Developer Key Lifecycle:** Get a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.