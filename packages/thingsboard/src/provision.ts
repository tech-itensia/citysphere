import { logger } from "@scaas/common";
import { TbClient, TbError, type EntityId } from "./client.ts";
import { DEVICE_TYPES, deviceProfileBody } from "./catalog.ts";
import { patchRootRuleChain } from "./rulechain.ts";

export interface TenantSpec {
  scaasTenantId: string;
  cityName: string;
  center: { lat: number; lon: number };
  zones: Array<{ name: string; lat: number; lon: number; perimeter?: unknown }>;
}

/** Sysadmin step: create the ThingsBoard tenant and an activated tenant-admin user (idempotent). */
export async function ensureTbTenant(sys: TbClient, input: { title: string; adminEmail: string; adminPassword: string }): Promise<{ tbTenantId: string }> {
  const page = await sys.get<{ data: Array<{ id: EntityId; title: string }> }>("/api/tenants", { pageSize: 100, page: 0, textSearch: input.title });
  let tenant = page.data.find((t) => t.title === input.title);
  if (!tenant) tenant = await sys.post("/api/tenant", { title: input.title });
  const tbTenantId = tenant!.id.id;

  const users = await sys.get<{ data: Array<{ id: EntityId; email: string }> }>(`/api/tenant/${tbTenantId}/users`, { pageSize: 100, page: 0, textSearch: input.adminEmail });
  if (!users.data.some((u) => u.email === input.adminEmail)) {
    const user = await sys.post<{ id: EntityId }>("/api/user", {
      tenantId: { entityType: "TENANT", id: tbTenantId },
      email: input.adminEmail,
      authority: "TENANT_ADMIN",
      firstName: "SCaaS",
      lastName: "Service",
    }, { sendActivationMail: false });
    const link = await sys.request<string>("GET", `/api/user/${user.id.id}/activationLink`);
    const activateToken = new URL(String(link).replace(/^"|"$/g, "")).searchParams.get("activateToken");
    if (!activateToken) throw new Error("Could not read activation token for tenant admin");
    const res = await fetch(`${sys.baseUrl}/api/noauth/activate?sendActivationMail=false`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ activateToken, password: input.adminPassword }),
    });
    if (!res.ok) throw new TbError(res.status, `Activation failed: ${await res.text()}`);
  }
  return { tbTenantId };
}

/** Create or update every catalogue device profile with its alarm rules. Returns name -> profile id. */
export async function ensureDeviceProfiles(tb: TbClient): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const def of DEVICE_TYPES) {
    const body = deviceProfileBody(def);
    const existing = await tb.findInPage<{ id: EntityId; name: string }>("/api/deviceProfiles", def.name);
    if (existing) {
      const full = await tb.get(`/api/deviceProfile/${existing.id.id}`);
      full.description = body.description;
      full.profileData.alarms = (body.profileData as { alarms: unknown[] }).alarms;
      await tb.post("/api/deviceProfile", full);
      ids[def.name] = existing.id.id;
    } else {
      const saved = await tb.post<{ id: EntityId }>("/api/deviceProfile", body);
      ids[def.name] = saved.id.id;
    }
  }
  return ids;
}

async function ensureAsset(tb: TbClient, name: string, type: string, label?: string): Promise<EntityId> {
  const found = await tb.findAsset(name);
  if (found) return found.id;
  const saved = await tb.saveAsset({ name, type, label: label ?? name });
  return saved.id;
}

/** Full tenant-admin provisioning: device profiles, City -> Zone asset tree, rule-chain export to Kafka. */
export async function provisionTenant(tb: TbClient, spec: TenantSpec, kafkaServers: string): Promise<void> {
  const log = logger.child({ tenant: spec.scaasTenantId });
  await ensureDeviceProfiles(tb);
  log.info({ profiles: DEVICE_TYPES.length }, "device profiles ready");

  const city = await ensureAsset(tb, spec.cityName, "City");
  await tb.saveAttributes(city, "SERVER_SCOPE", { latitude: spec.center.lat, longitude: spec.center.lon, scaasTenantId: spec.scaasTenantId });
  for (const z of spec.zones) {
    const zone = await ensureAsset(tb, z.name, "Zone");
    await tb.relate(city, zone);
    await tb.saveAttributes(zone, "SERVER_SCOPE", { latitude: z.lat, longitude: z.lon, ...(z.perimeter ? { perimeter: z.perimeter } : {}) });
  }
  log.info({ zones: spec.zones.length }, "asset tree ready");

  const result = await patchRootRuleChain(tb, spec.scaasTenantId, kafkaServers);
  log.info({ result }, "root rule chain export to Kafka");
}
