import assert from "node:assert/strict";
import test from "node:test";
import { InfraiControlPlane, type TenantControlPlane } from "../src/infrai_control_plane.js";
import { offboardTenantAccess, provisionTenantAccess } from "../src/tenant_access.js";

test("maps the account key response to the service credential shape", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    ok: true,
    data: { key_id: "ifr_...1234", key_secret: "ifr_secret" },
  }));
  const client = new InfraiControlPlane("test-control-plane-key", fetcher);

  const created = await client.createKey({
    project_id: "docs-preview",
    name: "devtools-docs-preview",
    scopes: ["developer-tools:read"],
    idempotency_key: "request:key",
  });

  assert.deepEqual(created, { id: "ifr_...1234", key: "ifr_secret" });
});

test("removes the credential owner when scoped key creation is rejected", async () => {
  const events: string[] = [];
  const client: TenantControlPlane = {
    async createUser() {
      events.push("user-created");
      return { user_id: "user_42" };
    },
    async createKey() {
      events.push("key-rejected");
      throw new Error("scope policy rejected the request");
    },
    async deleteUser(userId) {
      events.push(`user-deleted:${userId}`);
      return {};
    },
    async revokeKey() {
      throw new Error("not called");
    },
  };

  await assert.rejects(() =>
    provisionTenantAccess(client, {
      tenantId: "docs-preview",
      developerEmail: "dev@example.com",
      scopes: ["developer-tools:read"],
      requestId: "2ab5a12e-54bc-4b8a-83b8-5efbaabe67cc",
    }),
  );
  assert.deepEqual(events, ["user-created", "key-rejected", "user-deleted:user_42"]);
});

test("returns the one-time credential with tenant ownership details", async () => {
  const client: TenantControlPlane = {
    async createUser() { return { user_id: "user_7" }; },
    async createKey() { return { id: "key_9", key: "example-credential" }; },
    async deleteUser() { return {}; },
    async revokeKey() { return {}; },
  };

  const result = await provisionTenantAccess(client, {
    tenantId: "web-editor",
    developerEmail: "builder@example.com",
    scopes: ["developer-tools:read"],
    requestId: "4aa3b580-90b2-42c4-af9b-26488804659e",
  });

  assert.equal(result.state, "provisioned");
  assert.equal(result.userId, "user_7");
  assert.equal(result.keyId, "key_9");
});

test("revokes tenant access before removing its credential owner", async () => {
  const events: string[] = [];
  const client: TenantControlPlane = {
    async createUser() { return { user_id: "unused" }; },
    async createKey() { return { id: "unused", key: "unused" }; },
    async revokeKey(keyId) { events.push(`key-revoked:${keyId}`); return {}; },
    async deleteUser(userId) { events.push(`user-deleted:${userId}`); return {}; },
  };

  const result = await offboardTenantAccess(client, {
    tenantId: "web-editor",
    userId: "user_7",
    keyId: "key_9",
  });

  assert.equal(result.state, "offboarded");
  assert.deepEqual(events, ["key-revoked:key_9", "user-deleted:user_7"]);
});
