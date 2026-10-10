import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TenantControlPlane } from "./infrai_control_plane.js";

export const provisionTenantSchema = z.object({
  tenantId: z.string().min(1),
  developerEmail: z.string().email(),
  developerName: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).min(1),
  requestId: z.string().uuid().optional(),
});

export const offboardTenantSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  keyId: z.string().min(1),
});

export type ProvisionTenant = z.infer<typeof provisionTenantSchema>;
export type OffboardTenant = z.infer<typeof offboardTenantSchema>;

export type ProvisionedTenant = {
  state: "provisioned";
  tenantId: string;
  userId: string;
  keyId: string;
  credential: string;
  diagnostic: string;
};

export async function provisionTenantAccess(
  client: TenantControlPlane,
  rawInput: unknown,
): Promise<ProvisionedTenant> {
  const input = provisionTenantSchema.parse(rawInput);
  const requestId = input.requestId ?? randomUUID();
  const user = await client.createUser({
    email: input.developerEmail,
    name: input.developerName,
    metadata: { tenant_id: input.tenantId },
    idempotency_key: `${requestId}:user`,
  });

  try {
    const scopedKey = await client.createKey({
      project_id: input.tenantId,
      name: `devtools-${input.tenantId}`,
      scopes: input.scopes,
      idempotency_key: `${requestId}:key`,
    });
    return {
      state: "provisioned",
      tenantId: input.tenantId,
      userId: user.user_id,
      keyId: scopedKey.id,
      credential: scopedKey.key,
      diagnostic: "Store credential now; its plaintext is returned only once.",
    };
  } catch (error) {
    await client.deleteUser(user.user_id);
    throw error;
  }
}

export async function offboardTenantAccess(
  client: TenantControlPlane,
  rawInput: unknown,
) {
  const input = offboardTenantSchema.parse(rawInput);
  await client.revokeKey(input.keyId);
  await client.deleteUser(input.userId);
  return {
    state: "offboarded" as const,
    tenantId: input.tenantId,
    keyId: input.keyId,
    userId: input.userId,
    diagnostic: "Scoped key revoked and credential owner removed.",
  };
}
