import { z } from "zod";
import { randomBytes } from "node:crypto";
import type pg from "pg";
import {
  createApp, listen, ctx, requireRole, withTenant, runConsumer, publish, makeEvent, Topics, logger, audit, HttpError,
  waitFor, getPool, getRedis, tkey, env, internalHeaders, DEVMAP, type EventEnvelope, type Observation, type DeviceMapEntry,
  type MappingRule, type Persona,
} from "@scaas/common";
import { DEVICE_TYPES, deviceTypeByName, tenantTbClient, tenantProfileId } from "@scaas/thingsboard";
import {
  nextDeviceStatus, LifecycleError, DEVICE_ACTION_ROLES, nearestZone, validateImport, connectionInfo, slug,
  type DeviceAction, type DeviceStatus,
} from "./registry.ts";
import { seedDemoRegistry } from "./seed.ts";

const TENANT_URL = env("TENANT_SERVICE_URL", "http://tenant-service:3000");
const TB_PUBLIC_HOST = env("TB_PUBLIC_HOST", "localhost");
const INGEST_PUBLIC_URL = env("INGEST_PUBLIC_URL", `http://localhost:${env("INGEST_PORT", "8091")}`);
const OFFLINE_MS = 15 * 60_000;
const redis = getRedis();
const app = createApp({ internalOnly: true, ready: async () => { await getPool().query("select 1"); return true; } });

const READ: Persona[] = ["city_admin", "it_ops", "operator", "dept_head", "field_tech", "analyst", "leadership"];
const WRITE: Persona[] = ["city_admin", "it_ops"];

// ---------------------------------------------------------------- tenant metadata (zones, quotas) from tenant-service
let tenantCache: { at: number; rows: any[] } = { at: 0, rows: [] };
async function tenantMeta(tenantId: string): Promise<any | undefined> {
  if (Date.now() - tenantCache.at > 30_000) {
    try {
      const res = await fetch(`${TENANT_URL}/internal/tenants/all`, { headers: internalHeaders() });
      if (res.ok) tenantCache = { at: Date.now(), rows: (await res.json()) as any[] };
    } catch (err) { logger.warn({ err }, "tenant metadata unavailable"); }
  }
  return tenantCache.rows.find((t) => t.id === tenantId);
}

// ---------------------------------------------------------------- row mapping
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v ?? undefined);
const toDevice = (r: any) => ({
  deviceId: r.device_id, name: r.name ?? undefined, deviceType: r.device_type, domain: deviceTypeByName(r.device_type)?.domain ?? "generic",
  status: r.status as DeviceStatus, serial: r.serial ?? undefined, vendor: r.vendor ?? undefined, model: r.model ?? undefined,
  firmware: r.firmware ?? undefined, protocol: r.protocol, zone: r.zone ?? undefined, siteId: r.site_id ?? undefined,
  siteName: r.site_name ?? undefined, assetId: r.asset_id ?? undefined, assetName: r.asset_name ?? undefined,
  department: r.department ?? undefined, criticality: r.criticality, lat: r.lat ?? undefined, lon: r.lon ?? undefined,
  profileId: r.profile_id ?? undefined, profileName: r.profile_name ?? undefined, tbDeviceId: r.tb_device_id ?? undefined,
  firstSeen: iso(r.first_seen), lastSeen: iso(r.last_seen),
  online: r.last_seen ? Date.now() - new Date(r.last_seen).getTime() < OFFLINE_MS : false,
  installedAt: r.installed_at ? String(iso(r.installed_at)).slice(0, 10) : undefined, notes: r.notes ?? undefined,
  createdBy: r.created_by, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const toSite = (r: any) => ({ id: r.id, code: r.code, name: r.name, zone: r.zone ?? undefined, kind: r.kind, lat: r.lat ?? undefined, lon: r.lon ?? undefined, address: r.address ?? undefined, assets: r.assets ?? undefined, devices: r.devices ?? undefined });
const toAsset = (r: any) => ({ id: r.id, siteId: r.site_id ?? undefined, siteName: r.site_name ?? undefined, code: r.code, name: r.name, kind: r.kind, department: r.department ?? undefined, criticality: r.criticality, installedAt: r.installed_at ? String(iso(r.installed_at)).slice(0, 10) : undefined, warrantyUntil: r.warranty_until ? String(iso(r.warranty_until)).slice(0, 10) : undefined, attributes: r.attributes, devices: r.devices ?? undefined });

const DEVICE_SELECT = `select d.*, s.name site_name, a.name asset_name, p.name profile_name
  from asset.devices d left join asset.sites s on s.id = d.site_id left join asset.assets a on a.id = d.asset_id
  left join asset.mapping_profiles p on p.id = d.profile_id`;

async function getDeviceRow(db: pg.PoolClient, deviceId: string) {
  return (await db.query(`${DEVICE_SELECT} where d.device_id = $1`, [deviceId])).rows[0];
}

async function deviceEvent(db: pg.PoolClient, tenantId: string, deviceId: string, type: string, actor: string, data: Record<string, unknown> = {}) {
  await db.query("insert into asset.device_events (tenant_id, device_id, type, actor, data) values ($1,$2,$3,$4,$5)", [tenantId, deviceId, type, actor, JSON.stringify(data)]);
}

// ---------------------------------------------------------------- Redis projection used by normalizer / incident-service
async function syncDevmap(tenantId: string, deviceIds?: string[]) {
  const rows = await withTenant(tenantId, async (db) => (await db.query(
    `${DEVICE_SELECT} ${deviceIds ? "where d.device_id = any($1)" : ""}`, deviceIds ? [deviceIds] : [])).rows);
  const profiles = await withTenant(tenantId, async (db) => (await db.query("select id, rules from asset.mapping_profiles")).rows);
  const rulesOf = new Map<string, MappingRule[]>(profiles.map((p: any) => [p.id, p.rules]));
  const key = tkey(tenantId, DEVMAP);
  if (!deviceIds) await redis.del(key);
  for (const r of rows) {
    const entry: DeviceMapEntry = {
      deviceId: r.device_id, deviceType: r.device_type, status: r.status, zone: r.zone ?? undefined, lat: r.lat ?? undefined, lon: r.lon ?? undefined,
      department: r.department ?? undefined, site: r.site_name ?? undefined, asset: r.asset_name ?? undefined, criticality: r.criticality,
      rules: r.profile_id ? rulesOf.get(r.profile_id) : undefined,
    };
    await redis.hset(key, r.device_id, JSON.stringify(entry));
  }
}

async function emit(tenantId: string, type: string, device: any, actor: string, extra: Record<string, unknown> = {}) {
  await publish(Topics.assets, makeEvent({
    type, tenantId, source: "asset-service", entity: { type: "DEVICE", id: device.deviceId, name: device.name ?? device.deviceId },
    data: { device, actor, ...extra },
  })).catch((err) => logger.warn({ err }, "asset event publish failed"));
}

// ---------------------------------------------------------------- sites and assets (auto-created by name during import / wizard)
async function ensureSite(db: pg.PoolClient, tenantId: string, s: { name: string; zone?: string; kind?: string; lat?: number; lon?: number }): Promise<string> {
  const code = slug(s.name);
  const r = await db.query(
    `insert into asset.sites (tenant_id, code, name, zone, kind, lat, lon) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (tenant_id, code) do update set name = excluded.name returning id`,
    [tenantId, code, s.name, s.zone ?? null, s.kind ?? "site", s.lat ?? null, s.lon ?? null]);
  return r.rows[0].id;
}
async function ensureAsset(db: pg.PoolClient, tenantId: string, a: { name: string; siteId?: string; kind?: string; department?: string; criticality?: string }): Promise<string> {
  const code = slug(a.name);
  const r = await db.query(
    `insert into asset.assets (tenant_id, site_id, code, name, kind, department, criticality) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (tenant_id, code) do update set site_id = coalesce(excluded.site_id, asset.assets.site_id) returning id`,
    [tenantId, a.siteId ?? null, code, a.name, a.kind ?? "asset", a.department ?? null, a.criticality ?? "Medium"]);
  return r.rows[0].id;
}

// ---------------------------------------------------------------- catalogue & summary
app.get("/assets/catalog", async (req: any) => {
  ctx(req);
  return DEVICE_TYPES.map((t) => ({ name: t.name, prefix: t.prefix, domain: t.domain, description: t.description, telemetry: t.telemetry, alarms: t.alarms }));
});

app.get("/assets/summary", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ);
  return withTenant(c.tenantId, async (db) => {
    const rows = (await db.query("select device_type, status, zone, department, last_seen from asset.devices")).rows;
    const count = (f: (r: any) => string | undefined) => {
      const m = new Map<string, number>();
      for (const r of rows) { const k = f(r) ?? "Unassigned"; m.set(k, (m.get(k) ?? 0) + 1); }
      return [...m.entries()].map(([key, n]) => ({ key, count: n })).sort((a, b) => b.count - a.count);
    };
    const live = rows.filter((r: any) => !["Discovered", "Decommissioned"].includes(r.status));
    const offline = live.filter((r: any) => !r.last_seen || Date.now() - new Date(r.last_seen).getTime() > OFFLINE_MS).length;
    const [sites, assets, profiles] = await Promise.all([
      db.query("select count(*)::int n from asset.sites"), db.query("select count(*)::int n from asset.assets"), db.query("select count(*)::int n from asset.mapping_profiles"),
    ]);
    const meta = await tenantMeta(c.tenantId);
    return {
      total: rows.length, registered: live.length, offline, online: live.length - offline,
      discovered: rows.filter((r: any) => r.status === "Discovered").length,
      sites: sites.rows[0].n, assets: assets.rows[0].n, mappingProfiles: profiles.rows[0].n,
      quota: meta?.effectiveQuotas?.devices, byStatus: count((r) => r.status), byType: count((r) => r.device_type),
      byZone: count((r) => r.zone), byDepartment: count((r) => r.department),
    };
  });
});

// ---------------------------------------------------------------- hierarchy (zone -> site -> asset -> device)
app.get("/assets/hierarchy", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ);
  return withTenant(c.tenantId, async (db) => {
    const [sites, assets, devices] = await Promise.all([
      db.query("select * from asset.sites order by zone nulls last, name"),
      db.query("select * from asset.assets order by name"),
      db.query(`${DEVICE_SELECT} where d.status <> 'Decommissioned' order by d.device_id`),
    ]);
    const meta = await tenantMeta(c.tenantId);
    const zoneNames = new Set<string>((meta?.zones ?? []).map((z: any) => z.name));
    for (const s of sites.rows) if (s.zone) zoneNames.add(s.zone);
    for (const d of devices.rows) if (d.zone) zoneNames.add(d.zone);
    const devOf = (pred: (d: any) => boolean) => devices.rows.filter(pred).map((d: any) => {
      const x = toDevice(d);
      return { deviceId: x.deviceId, name: x.name, deviceType: x.deviceType, status: x.status, online: x.online, domain: x.domain };
    });
    const assetsOf = (siteId: string) => assets.rows.filter((a: any) => a.site_id === siteId).map((a: any) => ({ ...toAsset(a), devices: devOf((d) => d.asset_id === a.id) }));
    const zones = [...zoneNames].sort().map((zone) => ({
      zone,
      sites: sites.rows.filter((s: any) => s.zone === zone).map((s: any) => ({
        ...toSite(s), assets: assetsOf(s.id), devices: devOf((d) => d.site_id === s.id && !d.asset_id),
      })),
      devices: devOf((d) => d.zone === zone && !d.site_id),
    }));
    return { zones, unplaced: devOf((d) => !d.zone && !d.site_id) };
  });
});

app.get("/assets/sites", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ);
  return withTenant(c.tenantId, async (db) => (await db.query(
    `select s.*, (select count(*)::int from asset.assets a where a.site_id = s.id) assets,
       (select count(*)::int from asset.devices d where d.site_id = s.id) devices
     from asset.sites s ${req.query?.zone ? "where s.zone = $1" : ""} order by s.zone nulls last, s.name`, req.query?.zone ? [req.query.zone] : [])).rows.map(toSite));
});

const SiteBody = z.object({ name: z.string().min(2), zone: z.string().optional(), kind: z.string().default("site"), lat: z.number().optional(), lon: z.number().optional(), address: z.string().optional() });
app.post("/assets/sites", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const b = SiteBody.parse(req.body);
  const id = await withTenant(c.tenantId, async (db) => {
    const zone = b.zone ?? (b.lat !== undefined && b.lon !== undefined ? nearestZone({ lat: b.lat, lon: b.lon }, (await tenantMeta(c.tenantId))?.zones ?? []) : undefined);
    const siteId = await ensureSite(db, c.tenantId, { ...b, zone });
    if (b.address) await db.query("update asset.sites set address=$2 where id=$1", [siteId, b.address]);
    return siteId;
  });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "site.created", resource: `site/${id}` });
  return reply.code(201).send({ id });
});

app.get("/assets/assets", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ);
  const siteId = req.query?.siteId;
  return withTenant(c.tenantId, async (db) => (await db.query(
    `select a.*, s.name site_name, (select count(*)::int from asset.devices d where d.asset_id = a.id) devices
     from asset.assets a left join asset.sites s on s.id = a.site_id ${siteId ? "where a.site_id = $1" : ""} order by a.name`, siteId ? [siteId] : [])).rows.map(toAsset));
});

const AssetBody = z.object({ name: z.string().min(2), siteId: z.string().uuid().optional(), kind: z.string().default("asset"), department: z.string().optional(), criticality: z.enum(["Critical", "High", "Medium", "Low"]).default("Medium") });
app.post("/assets/assets", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const b = AssetBody.parse(req.body);
  const id = await withTenant(c.tenantId, (db) => ensureAsset(db, c.tenantId, b));
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "asset.created", resource: `asset/${id}` });
  return reply.code(201).send({ id });
});

// ---------------------------------------------------------------- devices
app.get("/assets/devices", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ);
  const q = req.query ?? {};
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replaceAll("?", `$${args.length}`)); };
  if (q.status) add("d.status = any(string_to_array(?, ','))", q.status);
  else if (q.includeDecommissioned !== "true") where.push("d.status <> 'Decommissioned'");
  if (q.type) add("d.device_type = ?", q.type);
  if (q.zone) add("d.zone = ?", q.zone);
  if (q.department) add("d.department = ?", q.department);
  if (q.siteId) add("d.site_id = ?::uuid", q.siteId);
  if (q.q) add("(d.device_id ilike ? or d.name ilike ? or d.serial ilike ?)", `%${q.q}%`);
  if (q.offline === "true") where.push(`(d.last_seen is null or d.last_seen < now() - interval '15 minutes') and d.status not in ('Discovered','Decommissioned')`);
  const limit = Math.min(Number(q.limit ?? 500), 2000);
  return withTenant(c.tenantId, async (db) => (await db.query(
    `${DEVICE_SELECT} ${where.length ? `where ${where.join(" and ")}` : ""} order by d.status = 'Discovered' desc, d.updated_at desc limit ${limit}`, args)).rows.map(toDevice));
});

app.get("/assets/devices/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ);
  return withTenant(c.tenantId, async (db) => {
    const r = await getDeviceRow(db, req.params.id);
    if (!r) throw new HttpError(404, "Device not in registry");
    const events = (await db.query("select type, actor, data, at from asset.device_events where device_id=$1 order by at desc limit 50", [req.params.id])).rows;
    const t = deviceTypeByName(r.device_type);
    return { ...toDevice(r), telemetryKeys: t?.telemetry ?? [], alarmRules: t?.alarms ?? [], events };
  });
});

const DeviceBody = z.object({
  deviceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/, "2-64 chars: letters, digits, . _ : -"),
  name: z.string().max(120).optional(),
  deviceType: z.string().refine((t) => !!deviceTypeByName(t), "Unknown device type"),
  serial: z.string().max(80).optional(), vendor: z.string().max(80).optional(), model: z.string().max(80).optional(), firmware: z.string().max(40).optional(),
  protocol: z.enum(["mqtt", "http", "http-ingest", "kafka", "connector"]).default("http-ingest"),
  zone: z.string().optional(), siteId: z.string().uuid().optional(), siteName: z.string().min(2).optional(),
  assetId: z.string().uuid().optional(), assetName: z.string().min(2).optional(), assetKind: z.string().optional(),
  department: z.string().optional(), criticality: z.enum(["Critical", "High", "Medium", "Low"]).default("Medium"),
  lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(),
  profileId: z.string().uuid().nullable().optional(), installedAt: z.string().optional(), notes: z.string().max(2000).optional(),
});

async function checkQuota(db: pg.PoolClient, tenantId: string, adding: number) {
  const meta = await tenantMeta(tenantId);
  const max = meta?.effectiveQuotas?.devices;
  if (!max) return;
  const n = (await db.query("select count(*)::int n from asset.devices where status not in ('Discovered','Decommissioned')")).rows[0].n;
  if (n + adding > max) throw new HttpError(409, `Device quota reached for plan ${meta.plan}: ${n}/${max}. Ask the platform admin to raise it.`);
}

/** Create or update one device from the wizard / API / CSV. Returns the device id. */
async function upsertDevice(db: pg.PoolClient, tenantId: string, actor: string, b: z.infer<typeof DeviceBody>, mode: "create" | "upsert" | "map"): Promise<"created" | "updated"> {
  const existing = (await db.query("select * from asset.devices where device_id=$1 for update", [b.deviceId])).rows[0];
  if (existing && mode === "create") throw new HttpError(409, `Device ${b.deviceId} is already registered (${existing.status})`);
  const zones = (await tenantMeta(tenantId))?.zones ?? [];
  const zone = b.zone ?? (b.lat !== undefined && b.lon !== undefined ? nearestZone({ lat: b.lat, lon: b.lon }, zones) : existing?.zone ?? undefined);
  let siteId = b.siteId ?? null;
  if (!siteId && b.siteName) siteId = await ensureSite(db, tenantId, { name: b.siteName, zone, lat: b.lat, lon: b.lon });
  let assetId = b.assetId ?? null;
  if (!assetId && b.assetName) assetId = await ensureAsset(db, tenantId, { name: b.assetName, siteId: siteId ?? undefined, kind: b.assetKind, department: b.department, criticality: b.criticality });
  const status = !existing ? "Registered" : existing.status === "Discovered" && mode !== "upsert" ? "Registered" : existing.status;
  if (!existing || existing.status === "Discovered") await checkQuota(db, tenantId, 1);
  await db.query(
    `insert into asset.devices (tenant_id, device_id, name, device_type, status, serial, vendor, model, firmware, protocol, zone, site_id, asset_id,
       department, criticality, lat, lon, profile_id, installed_at, notes, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     on conflict (tenant_id, device_id) do update set name=coalesce(excluded.name, asset.devices.name), device_type=excluded.device_type,
       status=excluded.status, serial=coalesce(excluded.serial, asset.devices.serial), vendor=coalesce(excluded.vendor, asset.devices.vendor),
       model=coalesce(excluded.model, asset.devices.model), firmware=coalesce(excluded.firmware, asset.devices.firmware), protocol=excluded.protocol,
       zone=coalesce(excluded.zone, asset.devices.zone), site_id=coalesce(excluded.site_id, asset.devices.site_id),
       asset_id=coalesce(excluded.asset_id, asset.devices.asset_id), department=coalesce(excluded.department, asset.devices.department),
       criticality=excluded.criticality, lat=coalesce(excluded.lat, asset.devices.lat), lon=coalesce(excluded.lon, asset.devices.lon),
       profile_id=coalesce(excluded.profile_id, asset.devices.profile_id), installed_at=coalesce(excluded.installed_at, asset.devices.installed_at),
       notes=coalesce(excluded.notes, asset.devices.notes), updated_at=now()`,
    [tenantId, b.deviceId, b.name ?? null, b.deviceType, status, b.serial ?? null, b.vendor ?? null, b.model ?? null, b.firmware ?? null, b.protocol,
      zone ?? null, siteId, assetId, b.department ?? null, b.criticality, b.lat ?? null, b.lon ?? null, b.profileId ?? null, b.installedAt ?? null, b.notes ?? null, actor]);
  if (b.profileId === null) await db.query("update asset.devices set profile_id = null where device_id = $1", [b.deviceId]);
  await deviceEvent(db, tenantId, b.deviceId, existing ? (existing.status === "Discovered" ? "mapped" : "updated") : "registered", actor, { zone, siteId, assetId, department: b.department });
  return existing ? "updated" : "created";
}

app.post("/assets/devices", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const b = DeviceBody.parse(req.body);
  const device = await withTenant(c.tenantId, async (db) => { await upsertDevice(db, c.tenantId, c.userName, b, "create"); return toDevice(await getDeviceRow(db, b.deviceId)); });
  await syncDevmap(c.tenantId, [b.deviceId]);
  await emit(c.tenantId, "device.registered", device, c.userId);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "device.registered", resource: `device/${b.deviceId}` });
  return reply.code(201).send(device);
});

/** Update mapping / metadata. Also used to map a Discovered device (it becomes Registered). Field techs may only correct location. */
app.put("/assets/devices/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE, "field_tech");
  const fieldOnly = !c.roles.some((r) => ["city_admin", "it_ops", "super_admin"].includes(r));
  const raw = { ...(req.body ?? {}), deviceId: req.params.id };
  const device = await withTenant(c.tenantId, async (db) => {
    const cur = await getDeviceRow(db, req.params.id);
    if (!cur) throw new HttpError(404, "Device not in registry");
    const b = fieldOnly
      ? DeviceBody.parse({ deviceId: cur.device_id, deviceType: cur.device_type, protocol: cur.protocol, criticality: cur.criticality, lat: raw.lat, lon: raw.lon, notes: raw.notes })
      : DeviceBody.parse({ deviceType: cur.device_type, protocol: cur.protocol, criticality: cur.criticality, ...raw });
    await upsertDevice(db, c.tenantId, c.userName, b, "map");
    return toDevice(await getDeviceRow(db, req.params.id));
  });
  await syncDevmap(c.tenantId, [req.params.id]);
  if (device.tbDeviceId) void pushTbAttributes(c.tenantId, device).catch((err) => logger.warn({ err }, "TB attribute sync failed"));
  await emit(c.tenantId, "device.updated", device, c.userId);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "device.updated", resource: `device/${req.params.id}` });
  return device;
});

async function pushTbAttributes(tenantId: string, d: ReturnType<typeof toDevice>) {
  const tb = await tenantTbClient(tenantId);
  await tb.saveAttributes({ entityType: "DEVICE", id: d.tbDeviceId! }, "SERVER_SCOPE", {
    zone: d.zone, latitude: d.lat, longitude: d.lon, department: d.department, site: d.siteName, asset: d.assetName,
    criticality: d.criticality, registryStatus: d.status, vendor: d.vendor, serial: d.serial,
  });
}

/** Create the device in ThingsBoard (profile + access token + attributes + zone relation) and return connection details. */
app.post("/assets/devices/:id/provision", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const cur = await withTenant(c.tenantId, (db) => getDeviceRow(db, req.params.id));
  if (!cur) throw new HttpError(404, "Device not in registry");
  let to: DeviceStatus;
  try { to = nextDeviceStatus(cur.status, "provision"); } catch (e) { throw new HttpError(409, (e as Error).message); }
  let tb;
  try { tb = await tenantTbClient(c.tenantId); } catch (err) { throw new HttpError(424, `ThingsBoard is not reachable for this city yet: ${(err as Error).message}`); }
  const token = randomBytes(15).toString("base64url");
  let tbId: string = cur.tb_device_id;
  const existing = await tb.findDevice(cur.device_id);
  if (existing) {
    tbId = existing.id.id;
    const cred = await tb.get(`/api/device/${tbId}/credentials`);
    await tb.post("/api/device/credentials", { ...cred, credentialsId: token });
  } else {
    const created = await tb.createDevice({
      name: cur.device_id, label: cur.name ?? cur.device_id, type: cur.device_type,
      deviceProfileId: await tenantProfileId(tb, c.tenantId, cur.device_type), additionalInfo: { description: `Registered in CitySphere by ${c.userName}` },
    }, token);
    tbId = created.id.id;
    if (cur.zone) {
      const zoneAsset = await tb.findAsset(cur.zone);
      if (zoneAsset) await tb.relate(zoneAsset.id, created.id);
    }
  }
  await redis.set(tkey(c.tenantId, "tbtok", cur.device_id), token, "EX", 24 * 3600);
  const device = await withTenant(c.tenantId, async (db) => {
    await db.query("update asset.devices set tb_device_id=$2, status=$3, updated_at=now() where device_id=$1", [cur.device_id, tbId, to]);
    await deviceEvent(db, c.tenantId, cur.device_id, existing ? "credentials.rotated" : "provisioned", c.userName, { tbDeviceId: tbId });
    return toDevice(await getDeviceRow(db, cur.device_id));
  });
  await pushTbAttributes(c.tenantId, device).catch((err) => logger.warn({ err }, "TB attribute sync failed"));
  await syncDevmap(c.tenantId, [cur.device_id]);
  await emit(c.tenantId, "device.provisioned", device, c.userId);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: existing ? "device.credentials.rotated" : "device.provisioned", resource: `device/${cur.device_id}` });
  return {
    device, token, note: "Store the access token now; it is shown once (rotate to issue a new one).",
    connection: connectionInfo({ protocol: device.protocol, deviceId: device.deviceId, token, tbHost: TB_PUBLIC_HOST, ingestUrl: INGEST_PUBLIC_URL, sampleKeys: deviceTypeByName(device.deviceType)?.telemetry ?? [] }),
  };
});

app.get("/assets/devices/:id/connection", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE, "field_tech");
  const d = await withTenant(c.tenantId, (db) => getDeviceRow(db, req.params.id));
  if (!d) throw new HttpError(404, "Device not in registry");
  return connectionInfo({ protocol: d.protocol, deviceId: d.device_id, tbHost: TB_PUBLIC_HOST, ingestUrl: INGEST_PUBLIC_URL, sampleKeys: deviceTypeByName(d.device_type)?.telemetry ?? [] });
});

const TransitionBody = z.object({ action: z.enum(["register", "commission", "maintenance", "fault", "restore", "decommission"]), note: z.string().max(1000).optional() });
app.post("/assets/devices/:id/transition", async (req: any) => {
  const c = ctx(req);
  const b = TransitionBody.parse(req.body);
  requireRole(c, ...(DEVICE_ACTION_ROLES[b.action as DeviceAction] as Persona[]));
  const device = await withTenant(c.tenantId, async (db) => {
    const cur = (await db.query("select * from asset.devices where device_id=$1 for update", [req.params.id])).rows[0];
    if (!cur) throw new HttpError(404, "Device not in registry");
    let to: DeviceStatus;
    try { to = nextDeviceStatus(cur.status, b.action); } catch (e) { if (e instanceof LifecycleError) throw new HttpError(409, e.message); throw e; }
    if (b.action === "register") await checkQuota(db, c.tenantId, 1);
    await db.query("update asset.devices set status=$2, updated_at=now() where device_id=$1", [cur.device_id, to]);
    await deviceEvent(db, c.tenantId, cur.device_id, `status.${b.action}`, c.userName, { from: cur.status, to, note: b.note });
    return toDevice(await getDeviceRow(db, cur.device_id));
  });
  await syncDevmap(c.tenantId, [device.deviceId]);
  if (device.tbDeviceId) void pushTbAttributes(c.tenantId, device).catch(() => undefined);
  await emit(c.tenantId, "device.status.changed", device, c.userId, { action: b.action });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: `device.${b.action}`, resource: `device/${device.deviceId}` });
  return device;
});

/** CSV bulk import. ?dryRun=true validates only. Body: { csv: "deviceId,deviceType,..." } */
app.post("/assets/devices/import", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const { csv } = z.object({ csv: z.string().min(10).max(5_000_000) }).parse(req.body);
  const { rows, issues } = validateImport(csv, DEVICE_TYPES.map((t) => t.name));
  const dryRun = req.query?.dryRun === "true";
  const existing = await withTenant(c.tenantId, async (db) => new Set<string>((await db.query("select device_id from asset.devices where device_id = any($1)", [rows.map((r) => r.deviceId)])).rows.map((r: any) => r.device_id)));
  const preview = rows.map((r) => ({ ...r, action: existing.has(r.deviceId) ? "update" : "create" }));
  if (dryRun || issues.length) return { dryRun: true, valid: rows.length, invalid: issues.length, issues, preview: preview.slice(0, 200) };
  let created = 0, updated = 0;
  await withTenant(c.tenantId, async (db) => {
    await checkQuota(db, c.tenantId, preview.filter((p) => p.action === "create").length);
    for (const r of rows) {
      const out = await upsertDevice(db, c.tenantId, c.userName, DeviceBody.parse({
        deviceId: r.deviceId, name: r.name, deviceType: r.deviceType, serial: r.serial, vendor: r.vendor, model: r.model, firmware: r.firmware,
        protocol: r.protocol, zone: r.zone, siteName: r.site, assetName: r.asset, department: r.department, criticality: r.criticality, lat: r.lat, lon: r.lon,
      }), "upsert");
      if (out === "created") created++; else updated++;
    }
  });
  await syncDevmap(c.tenantId, rows.map((r) => r.deviceId));
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "device.imported", resource: "devices", data: { created, updated } });
  return { dryRun: false, created, updated, issues: [] };
});

app.get("/assets/import-template", async () => [
  "deviceId,name,deviceType,serial,vendor,model,firmware,protocol,zone,site,asset,department,criticality,lat,lon",
  "SL-CP-101,CP Lamp 101,Street Light,SN-0001,Signify,CityTouch,2.4.1,mqtt,Connaught Place,CP Inner Circle,Pole CP-101,Street Lighting,Medium,28.6318,77.2169",
  "WN-KB-201,KB Main Line 201,Water Node,SN-0002,Siemens,SITRANS,1.9,http-ingest,Karol Bagh,KB Pump Station 2,Main KB-201,Water Supply,High,28.6511,77.1902",
].join("\n"));

// ---------------------------------------------------------------- mapping profiles (vendor key -> canonical key)
const RuleSchema = z.object({ from: z.string().min(1), to: z.string().default(""), scale: z.number().optional(), offset: z.number().optional(), drop: z.boolean().optional() });
const ProfileBody = z.object({ name: z.string().min(2), vendor: z.string().optional(), deviceType: z.string().optional(), rules: z.array(RuleSchema).max(200) });

app.get("/assets/mapping-profiles", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ);
  return withTenant(c.tenantId, async (db) => (await db.query(
    "select p.*, (select count(*)::int from asset.devices d where d.profile_id = p.id) devices from asset.mapping_profiles p order by name")).rows
    .map((r: any) => ({ id: r.id, name: r.name, vendor: r.vendor ?? undefined, deviceType: r.device_type ?? undefined, rules: r.rules, devices: r.devices, createdAt: iso(r.created_at) })));
});

app.post("/assets/mapping-profiles", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const b = ProfileBody.parse(req.body);
  const row = await withTenant(c.tenantId, async (db) => (await db.query(
    "insert into asset.mapping_profiles (tenant_id, name, vendor, device_type, rules) values ($1,$2,$3,$4,$5) returning id",
    [c.tenantId, b.name, b.vendor ?? null, b.deviceType ?? null, JSON.stringify(b.rules)])).rows[0]);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "mapping.created", resource: `mapping/${row.id}` });
  return reply.code(201).send(row);
});

app.put("/assets/mapping-profiles/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const b = ProfileBody.parse(req.body);
  const ids = await withTenant(c.tenantId, async (db) => {
    await db.query("update asset.mapping_profiles set name=$2, vendor=$3, device_type=$4, rules=$5 where id=$1", [req.params.id, b.name, b.vendor ?? null, b.deviceType ?? null, JSON.stringify(b.rules)]);
    return (await db.query("select device_id from asset.devices where profile_id=$1", [req.params.id])).rows.map((r: any) => r.device_id);
  });
  if (ids.length) await syncDevmap(c.tenantId, ids);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "mapping.updated", resource: `mapping/${req.params.id}` });
  return { updated: true, devices: ids.length };
});

app.delete("/assets/mapping-profiles/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...WRITE);
  const ids = await withTenant(c.tenantId, async (db) => {
    const list = (await db.query("update asset.devices set profile_id=null where profile_id=$1 returning device_id", [req.params.id])).rows.map((r: any) => r.device_id);
    await db.query("delete from asset.mapping_profiles where id=$1", [req.params.id]);
    return list;
  });
  if (ids.length) await syncDevmap(c.tenantId, ids);
  return { deleted: true };
});

// ---------------------------------------------------------------- internal: platform usage for the super admin console
app.get("/internal/usage", async () => withTenant("*", async (db) => (await db.query(
  `select tenant_id, count(*)::int total,
     count(*) filter (where status = 'Active')::int active,
     count(*) filter (where status = 'Discovered')::int discovered,
     count(*) filter (where status not in ('Discovered','Decommissioned') and (last_seen is null or last_seen < now() - interval '15 minutes'))::int offline
   from asset.devices group by tenant_id`)).rows));

// ---------------------------------------------------------------- auto-discovery + last-seen from the observation stream
async function onObservation(event: EventEnvelope<Observation>) {
  const o = event.data;
  const t = event.tenantId;
  if (!o?.deviceId) return;
  const known = await redis.hget(tkey(t, DEVMAP), o.deviceId);
  if (!known) {
    // unknown sender: put it in the Discovered queue so an admin can map it (never blocks the data path)
    const type = deviceTypeByName(o.deviceType) ? o.deviceType : "Generic Sensor";
    await withTenant(t, async (db) => {
      const r = await db.query(
        `insert into asset.devices (tenant_id, device_id, device_type, status, protocol, zone, lat, lon, first_seen, last_seen, created_by)
         values ($1,$2,$3,'Discovered',$4,$5,$6,$7,now(),now(),'discovery') on conflict do nothing returning device_id`,
        [t, o.deviceId, type, o.origin === "thingsboard" ? "mqtt" : o.origin?.startsWith("connector") ? "connector" : "http-ingest", o.zone ?? null, o.location?.lat ?? null, o.location?.lon ?? null]);
      if (r.rowCount) await deviceEvent(db, t, o.deviceId, "discovered", "discovery", { origin: o.origin, keys: Object.keys(o.values ?? {}) });
    });
    await syncDevmap(t, [o.deviceId]);
    return;
  }
  // throttle last_seen writes to once a minute per device
  const ok = await redis.set(tkey(t, "lastseen", o.deviceId), "1", "EX", 60, "NX");
  if (ok) {
    await withTenant(t, (db) => db.query(
      "update asset.devices set last_seen = to_timestamp($2/1000.0), first_seen = coalesce(first_seen, to_timestamp($2/1000.0)) where device_id = $1",
      [o.deviceId, o.ts || Date.now()]));
  }
}

// ---------------------------------------------------------------- start
await waitFor("postgres", () => getPool().query("select 1"));
await listen(app);
logger.info("asset-service ready");

// rebuild the Redis projection for every city, seed demo registries, then start discovery
void (async () => {
  try {
    const tenants = await withTenant("*", async (db) => (await db.query("select id from tenant.tenants")).rows.map((r: any) => r.id as string));
    for (const t of tenants) {
      if (env("SEED_DEMO", "true") === "true") await seedDemoRegistry(t, (await tenantMeta(t))?.zones).catch((err) => logger.warn({ err, t }, "demo registry seed skipped"));
      await syncDevmap(t);
    }
    logger.info({ tenants: tenants.length }, "device map projection rebuilt");
  } catch (err) { logger.error({ err }, "device map rebuild failed"); }
  await waitFor("kafka", () => runConsumer<Observation>({ groupId: "asset-registry", topics: [Topics.observations], handler: onObservation }));
})();
