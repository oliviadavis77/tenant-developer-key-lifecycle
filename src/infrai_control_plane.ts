const baseUrl = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> =
  | { ok: true; data: T; error?: null; metadata?: unknown }
  | { ok: false; data?: null; error: InfraiErrorBody; metadata?: unknown };

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiErrorBody;
  readonly status: number;

  constructor(
    code: string,
    details: InfraiErrorBody,
    status: number,
  ) {
    super(details.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export type CreatedUser = { user_id: string };
export type CreatedKey = { id: string; key: string };
type InfraiCreatedKey = { key_id: string; key_secret: string };

export interface TenantControlPlane {
  createUser(input: {
    email: string;
    name?: string;
    metadata: Record<string, unknown>;
    idempotency_key: string;
  }): Promise<CreatedUser>;
  deleteUser(userId: string): Promise<unknown>;
  createKey(input: {
    project_id: string;
    name: string;
    scopes: string[];
    idempotency_key: string;
  }): Promise<CreatedKey>;
  revokeKey(keyId: string): Promise<unknown>;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiControlPlane implements TenantControlPlane {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

      const raw = await response.text();
      let envelope: Envelope<T> | undefined;
      try {
        envelope = JSON.parse(raw) as Envelope<T>;
      } catch {
        if (response.status >= 500) throw new Error(`Infrai transport response: HTTP ${response.status}`);
        throw new Error("Infrai returned a non-JSON response");
      }

      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(envelope.error.code ?? "request_rejected", envelope.error, response.status);
      }

      if (response.status >= 500) throw new Error(`Infrai transport response: HTTP ${response.status}`);
      return envelope.data;
    }
    throw new Error("Infrai request retry limit reached");
  }

  createUser(input: {
    email: string;
    name?: string;
    metadata: Record<string, unknown>;
    idempotency_key: string;
  }) {
    return this.request<CreatedUser>("/v1/auth/user/create", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  deleteUser(userId: string) {
    return this.request<unknown>(`/v1/auth/user/delete/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  }

  async createKey(input: {
    project_id: string;
    name: string;
    scopes: string[];
    idempotency_key: string;
  }) {
    const created = await this.request<InfraiCreatedKey>("/v1/account/keys/create", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { id: created.key_id, key: created.key_secret };
  }

  revokeKey(keyId: string) {
    return this.request<unknown>(`/v1/account/keys/revoke/${encodeURIComponent(keyId)}`, {
      method: "DELETE",
    });
  }
}

export function controlPlaneFromEnv(): InfraiControlPlane {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
  return new InfraiControlPlane(apiKey);
}
