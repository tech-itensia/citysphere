import { env, internalHeaders, getRedis, tkey, logger, type Observation } from "@scaas/common";
import { TbClient, TbError, deviceTypeByName, type EntityId } from "@scaas/thingsboard";
import { randomBytes } from "node:crypto";

const TB_URL = env("TB_URL", "http://tb-proxy");
const TB_HTTP_URL = env("TB_HTTP_TRANSPORT_URL", "http://tb-http-transport:8081");
const TENANT_SERVICE_URL = env("TENANT_SERVICE_URL", "http://tenant-service:3000");

const clients = new Map<string, TbClient>();
const profiles = new Map<string, Map<string, EntityId>>();
const redis = getRedis();

/** Tenant-admin ThingsBoard client, credentials fetched from tenant-service. */
export async function tbFor(tenantId: string): Promise<TbClient> {
  const hit = clients.get(tenantId);
  if (hit) return hit;
  const res = await fetch(`${TENANT_SERVICE_URL}/internal/tenants/${tenantId}/tb-credentials`, { headers: internalHeaders() });
  if (!res.ok) throw new Error(`No ThingsBoard credentials for tenant ${tenantId} (${res.status})`);
  const { email, password } = (await res.json()) as { email: string; password: string };
  const client = new TbClient(TB_URL, email, password);
  await client.login();
  clients.set(tenantId, client);
  return client;
}

async function profileId(tb: TbClient, tenantId: string, name: string): Promise<EntityId | undefined> {
  let map = profiles.get(tenantId);
  if (!map) {
    map = new Map();
    const page = await tb.get<{ data: Array<{ id: EntityId; name: string }> }>("/api/deviceProfiles", { pageSize: 200, page: 0 });
    for (const p of page.data) map.set(p.name, p.id);
    profiles.set(tenantId, map);
  }
  return map.get(name) ?? map.get("Generic Sensor") ?? map.get("default");
}

/** Find or auto-register the device in ThingsBoard; returns its access token (cached in Redis). */
export async function deviceToken(tenantId: string, obs: Observation): Promise<string> {
  const cacheKey = tkey(tenantId, "tbtok", obs.deviceId);
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const tb = await tbFor(tenantId);
  const existing = await tb.findDevice(obs.deviceId);
  let token: string;
  if (existing) {
    token = await tb.deviceToken(existing.id.id);
  } else {
    const typeName = deviceTypeByName(obs.deviceType) ? obs.deviceType : "Generic Sensor";
    token = randomBytes(15).toString("base64url");
    const device = await tb.createDevice({
      name: obs.deviceId,
      label: obs.deviceId,
      type: typeName,
      deviceProfileId: await profileId(tb, tenantId, typeName),
      additionalInfo: { description: `Auto-registered from ${obs.origin}` },
    }, token);
    const attrs: Record<string, unknown> = { scaasOrigin: obs.origin, ...(obs.attributes ?? {}) };
    if (obs.location) Object.assign(attrs, { latitude: obs.location.lat, longitude: obs.location.lon });
    if (obs.zone) attrs.zone = obs.zone;
    await tb.saveAttributes(device.id, "SERVER_SCOPE", attrs);
    if (obs.zone) {
      const zone = await tb.findAsset(obs.zone);
      if (zone) await tb.relate(zone.id, device.id);
    }
    logger.info({ tenantId, deviceId: obs.deviceId, type: typeName }, "device auto-registered in ThingsBoard");
  }
  await redis.set(cacheKey, token, "EX", 24 * 3600);
  return token;
}

/** Push through the device HTTP API so ThingsBoard's rule engine (alarm rules) sees the data. */
export async function pushTelemetry(tenantId: string, obs: Observation, retried = false): Promise<void> {
  const token = await deviceToken(tenantId, obs);
  const values: Record<string, unknown> = { ...obs.values, ingestSource: "kafka" };
  if (obs.location) Object.assign(values, { latitude: obs.location.lat, longitude: obs.location.lon });
  const res = await fetch(`${TB_HTTP_URL}/api/v1/${token}/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ts: obs.ts, values }),
  });
  if ((res.status === 401 || res.status === 404) && !retried) {
    await redis.del(tkey(tenantId, "tbtok", obs.deviceId));
    return pushTelemetry(tenantId, obs, true);
  }
  if (!res.ok) throw new TbError(res.status, `telemetry push failed for ${obs.deviceId}: ${await res.text()}`);
}

/** Device id (TB uuid) by name, for history and alarm reads. */
export async function tbDevice(tenantId: string, deviceId: string) {
  const tb = await tbFor(tenantId);
  return { tb, device: await tb.findDevice(deviceId) };
}
