import { logger } from "@scaas/common";

export class TbError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "TbError";
    this.status = status;
  }
}

export interface EntityId { entityType: string; id: string }

/** ThingsBoard REST client for one user (sysadmin or a tenant admin). Re-logs in on 401. */
export class TbClient {
  readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private token?: string;
  private refreshToken?: string;
  private loginPromise?: Promise<void>;

  constructor(baseUrl: string, username: string, password: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.username = username;
    this.password = password;
  }

  async login(): Promise<void> {
    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const res = await fetch(`${this.baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: this.username, password: this.password }),
        });
        if (!res.ok) throw new TbError(res.status, `ThingsBoard login failed for ${this.username}: ${await res.text()}`);
        const body = (await res.json()) as { token: string; refreshToken: string };
        this.token = body.token;
        this.refreshToken = body.refreshToken;
      })().finally(() => { this.loginPromise = undefined; });
    }
    return this.loginPromise;
  }

  async request<T = any>(method: string, path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>, retry = true): Promise<T> {
    if (!this.token) await this.login();
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", "x-authorization": `Bearer ${this.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && retry) {
      this.token = undefined;
      await this.login();
      return this.request<T>(method, path, body, query, false);
    }
    if (!res.ok) throw new TbError(res.status, `${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T; // e.g. /api/user/{id}/activationLink returns a plain URL
    }
  }

  get<T = any>(path: string, query?: Record<string, string | number | boolean | undefined>) { return this.request<T>("GET", path, undefined, query); }
  post<T = any>(path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>) { return this.request<T>("POST", path, body, query); }
  delete<T = any>(path: string) { return this.request<T>("DELETE", path); }

  /** GET that maps 404 to undefined. */
  async find<T = any>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T | undefined> {
    try {
      return await this.get<T>(path, query);
    } catch (err) {
      if (err instanceof TbError && err.status === 404) return undefined;
      throw err;
    }
  }

  /** Exact-name search over a paged list endpoint. */
  async findInPage<T extends { name?: string; title?: string }>(path: string, name: string, extra: Record<string, string> = {}): Promise<T | undefined> {
    const page = await this.get<{ data: T[] }>(path, { pageSize: 100, page: 0, textSearch: name, ...extra });
    return page.data.find((x) => x.name === name || x.title === name);
  }

  // ---- entities ---------------------------------------------------------
  findDevice(name: string) { return this.find("/api/tenant/devices", { deviceName: name }); }
  findAsset(name: string) { return this.find("/api/tenant/assets", { assetName: name }); }
  saveAsset(asset: Record<string, unknown>) { return this.post("/api/asset", asset); }
  createDevice(device: Record<string, unknown>, accessToken?: string) { return this.post("/api/device", device, { accessToken }); }
  async deviceToken(deviceId: string): Promise<string> {
    return (await this.get<{ credentialsId: string }>(`/api/device/${deviceId}/credentials`)).credentialsId;
  }
  relate(from: EntityId, to: EntityId, type = "Contains") {
    return this.post("/api/relation", { from, to, type, typeGroup: "COMMON" });
  }
  saveAttributes(entity: EntityId, scope: "SERVER_SCOPE" | "SHARED_SCOPE", attrs: Record<string, unknown>) {
    return this.post(`/api/plugins/telemetry/${entity.entityType}/${entity.id}/attributes/${scope}`, attrs);
  }

  log() { return logger.child({ tb: this.baseUrl, user: this.username }); }
}
