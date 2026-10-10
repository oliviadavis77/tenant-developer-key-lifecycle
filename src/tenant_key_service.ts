import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { controlPlaneFromEnv, InfraiError } from "./infrai_control_plane.js";
import { offboardTenantAccess, provisionTenantAccess } from "./tenant_access.js";

const client = controlPlaneFromEnv();
const port = Number(process.env.PORT ?? 3000);

function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Buffer | string>): Promise<unknown> {
  let body = "";
  for await (const chunk of request) body += chunk.toString();
  return JSON.parse(body);
}

createServer(async (request, response) => {
  try {
    const body = await readJson(request);
    if (request.method === "POST" && request.url === "/tenants/provision") {
      return reply(response, 201, await provisionTenantAccess(client, body));
    }
    if (request.method === "POST" && request.url === "/tenants/offboard") {
      return reply(response, 200, await offboardTenantAccess(client, body));
    }
    return reply(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof ZodError) {
      return reply(response, 400, { error: "Invalid request", issues: error.issues });
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return reply(response, status, { error: error.code, message: error.message });
    }
    const message = error instanceof Error ? error.message : "Unexpected service error";
    return reply(response, 500, { error: message });
  }
}).listen(port, () => {
  console.log(`Tenant key service listening on http://localhost:${port}`);
});
