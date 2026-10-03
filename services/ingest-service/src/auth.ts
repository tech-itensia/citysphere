import { common, env, HttpError, internalHeaders } from "@scaas/common";

export interface Caller { tenantId: string; keyId: string; scopes: string[] }

const cache = new Map<string, { caller: Caller; expires: number }>();
const TENANT_SERVICE_URL = env("TENANT_SERVICE_URL", "http://tenant-service:3000");

/**
 * Two ways to call ingest:
 *  - devices / integrators: `x-api-key: <tenant api key>` (verified by tenant-service, cached 60 s)
 *  - internal services: `x-internal-token` + `x-tenant-id`
 */
export async function authenticate(headers: Record<string, unknown>): Promise<Caller> {
  const internal = headers["x-internal-token"];
  if (typeof internal === "string" && internal === common.internalToken()) {
    const tenantId = headers["x-tenant-id"];
    if (typeof tenantId !== "string" || !tenantId) throw new HttpError(400, "x-tenant-id required with internal token");
    return { tenantId, keyId: "internal", scopes: ["telemetry:write"] };
  }
  const apiKey = headers["x-api-key"];
  if (typeof apiKey !== "string" || apiKey.length < 16) throw new HttpError(401, "x-api-key header is required");

  const hit = cache.get(apiKey);
  if (hit && hit.expires > Date.now()) return hit.caller;

  const res = await fetch(`${TENANT_SERVICE_URL}/internal/api-keys/verify`, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({ key: apiKey }),
  });
  if (res.status === 401 || res.status === 404) throw new HttpError(401, "Invalid API key");
  if (!res.ok) throw new HttpError(503, "Key verification unavailable");
  const caller = (await res.json()) as Caller;
  if (!caller.scopes.includes("telemetry:write")) throw new HttpError(403, "API key lacks telemetry:write scope");
  cache.set(apiKey, { caller, expires: Date.now() + 60_000 });
  return caller;
}
