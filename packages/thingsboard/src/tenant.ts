import { env, internalHeaders } from "@scaas/common";
import { TbClient } from "./client.ts";

const clients = new Map<string, TbClient>();

/** Tenant-admin ThingsBoard client for one city; credentials come from tenant-service (cached per process). */
export async function tenantTbClient(tenantId: string): Promise<TbClient> {
  const hit = clients.get(tenantId);
  if (hit) return hit;
  const tenantUrl = env("TENANT_SERVICE_URL", "http://tenant-service:3000");
  const res = await fetch(`${tenantUrl}/internal/tenants/${tenantId}/tb-credentials`, { headers: internalHeaders() });
  if (!res.ok) throw new Error(`No ThingsBoard credentials for tenant ${tenantId} (${res.status})`);
  const { email, password } = (await res.json()) as { email: string; password: string };
  const client = new TbClient(env("TB_URL", "http://tb-proxy"), email, password);
  await client.login();
  clients.set(tenantId, client);
  return client;
}

/** Device-profile id by name for a tenant (cached). */
const profiles = new Map<string, Map<string, { entityType: string; id: string }>>();
export async function tenantProfileId(tb: TbClient, tenantId: string, name: string) {
  let map = profiles.get(tenantId);
  if (!map) {
    map = new Map();
    const page = await tb.get<{ data: Array<{ id: { entityType: string; id: string }; name: string }> }>("/api/deviceProfiles", { pageSize: 200, page: 0 });
    for (const p of page.data) map.set(p.name, p.id);
    profiles.set(tenantId, map);
  }
  return map.get(name) ?? map.get("Generic Sensor") ?? map.get("default");
}
