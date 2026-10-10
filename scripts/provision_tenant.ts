import { controlPlaneFromEnv } from "../src/infrai_control_plane.js";
import { provisionTenantAccess } from "../src/tenant_access.js";

const tenantId = process.argv[2];
const developerEmail = process.argv[3];

if (!tenantId || !developerEmail) {
  console.error("Usage: npm run demo -- <tenant-id> <developer-email>");
  process.exit(1);
}

const result = await provisionTenantAccess(controlPlaneFromEnv(), {
  tenantId,
  developerEmail,
  scopes: ["developer-tools:read", "developer-tools:write"],
});

console.log(JSON.stringify(result, null, 2));
