import { z } from "zod";
import {
  createApp, listen, ctx, requireRole, withTenant, env, HttpError, logger, audit, sha256, waitFor, getPool,
} from "@scaas/common";
import { TbClient, ensureTbTenant, provisionTenant } from "@scaas/thingsboard";
import { encrypt, decrypt, randomSecret } from "./secrets.ts";
import { DEMO_TENANTS } from "./demo.ts";
import { PLANS, MODULES, effectiveQuotas, effectiveModules } from "./plans.ts";
import { ensureGroup, listCityUsers, createCityUser, setRole, setEnabled, resetPassword, userInTenant, CITY_ROLES } from "./kc.ts";

const TB_URL = env("TB_URL", "http://tb-proxy");
const KAFKA_FOR_TB = env("TB_KAFKA_SERVERS", "kafka:9092");
const sysadmin = new TbClient(TB_URL, env("TB_SYSADMIN_EMAIL", "sysadmin@thingsboard.org"), env("TB_SYSADMIN_PASSWORD", "sysadmin"));

const Zone = z.object({ name: z.string().min(1), lat: z.number(), lon: z.number(), perimeter: z.unknown().optional() });
const TenantBody = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, "lowercase id, 2-31 chars"),
  name: z.string().min(2),
  cityName: z.string().min(2),
  center: z.object({ lat: z.number(), lon: z.number() }),
  zones: z.array(Zone).default([]),
  branding: z.record(z.string(), z.unknown()).default({}),
  plan: z.enum(["starter", "standard", "enterprise"]).default("standard"),
  modules: z.array(z.string()).optional(),
  quotas: z.record(z.string(), z.number()).default({}),
  population: z.number().int().positive().optional(),
  contact: z.object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }).default({}),
  adminUser: z.object({
    username: z.string().regex(/^[a-z0-9._-]{3,40}$/), email: z.string().email().optional(), firstName: z.string().optional(), lastName: z.string().optional(),
    password: z.string().min(8).default("Welcome@123"),
  }).optional(),
});
type TenantInput = z.infer<typeof TenantBody>;

const app = createApp({ internalOnly: true, ready: async () => { await getPool().query("select 1"); return true; } });

// ---------------------------------------------------------------- provisioning
async function step(tenantId: string, msg: string, ok = true) {
  await withTenant(tenantId, (c) => c.query(
    "update tenant.tenants set provision_log = (provision_log || $2::jsonb) where id=$1",
    [tenantId, JSON.stringify([{ at: new Date().toISOString(), step: msg, ok }])])).catch(() => undefined);
}

async function provision(tenantId: string): Promise<void> {
  const row = await withTenant(tenantId, async (c) => (await c.query("select * from tenant.tenants where id=$1", [tenantId])).rows[0]);
  if (!row) throw new HttpError(404, "Tenant not found");
  try {
    await withTenant(tenantId, (c) => c.query("update tenant.tenants set status='provisioning', error=null, provision_log='[]', updated_at=now() where id=$1", [tenantId]));
    await step(tenantId, "Provisioning started");
    const email: string = row.tb_admin_email ?? `scaas-${tenantId}@tenants.scaas.local`;
    const password: string = row.tb_admin_password_enc ? decrypt(row.tb_admin_password_enc) : randomSecret();
    const { tbTenantId } = await waitFor("thingsboard", () => ensureTbTenant(sysadmin, { title: `SCaaS ${row.name}`, adminEmail: email, adminPassword: password }), 120, 5000);
    await withTenant(tenantId, (c) => c.query(
      "update tenant.tenants set tb_tenant_id=$2, tb_admin_email=$3, tb_admin_password_enc=$4, updated_at=now() where id=$1",
      [tenantId, tbTenantId, email, encrypt(password)]));
    await step(tenantId, `ThingsBoard tenant ready (${tbTenantId})`);
    const tb = new TbClient(TB_URL, email, password);
    await provisionTenant(tb, { scaasTenantId: tenantId, cityName: row.city_name, center: row.center, zones: row.zones }, KAFKA_FOR_TB);
    await step(tenantId, "Device profiles, zone assets and rule chain (Kafka export) configured");
    await ensureGroup(tenantId).then(() => step(tenantId, "Keycloak group /tenants/" + tenantId + " ready")).catch((err) => step(tenantId, `Keycloak group not created: ${(err as Error).message}`, false));
    await withTenant(tenantId, (c) => c.query("update tenant.tenants set status='active', updated_at=now() where id=$1", [tenantId]));
    await step(tenantId, "City is active");
    logger.info({ tenantId, tbTenantId }, "tenant provisioned");
  } catch (err) {
    logger.error({ err, tenantId }, "tenant provisioning failed");
    await step(tenantId, `Failed: ${(err as Error).message.slice(0, 300)}`, false);
    await withTenant(tenantId, (c) => c.query("update tenant.tenants set status='failed', error=$2, updated_at=now() where id=$1", [tenantId, (err as Error).message.slice(0, 1000)]));
    throw err;
  }
}

async function createTenant(t: Pick<TenantInput, "id" | "name" | "cityName" | "center" | "zones" | "branding"> & Partial<TenantInput>): Promise<void> {
  await withTenant(t.id, (c) => c.query(
    `insert into tenant.tenants (id, name, city_name, center, zones, branding, status, plan, modules, quotas, population, contact)
     values ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11) on conflict (id) do nothing`,
    [t.id, t.name, t.cityName, JSON.stringify(t.center), JSON.stringify(t.zones), JSON.stringify(t.branding),
      t.plan ?? "standard", effectiveModules(t.plan ?? "standard", t.modules), JSON.stringify(t.quotas ?? {}), t.population ?? null, JSON.stringify(t.contact ?? {})]));
}

async function createApiKey(tenantId: string, name: string, scopes: string[], createdBy: string, plain?: string) {
  const key = plain ?? `sk_${tenantId}_${randomSecret(24)}`;
  const row = await withTenant(tenantId, async (c) => (await c.query(
    `insert into tenant.api_keys (tenant_id, name, prefix, key_hash, scopes, created_by)
     values ($1,$2,$3,$4,$5,$6) on conflict (key_hash) do update set revoked_at = null
     returning id, name, prefix, scopes, created_at`,
    [tenantId, name, key.slice(0, 12), sha256(key), scopes, createdBy])).rows[0]);
  return { ...row, key };
}

const publicTenant = (r: any) => ({
  id: r.id, name: r.name, cityName: r.city_name, center: r.center, zones: r.zones, branding: r.branding,
  status: r.status, error: r.error ?? undefined, tbTenantId: r.tb_tenant_id ?? undefined, createdAt: r.created_at,
  plan: r.plan ?? "standard", modules: effectiveModules(r.plan ?? "standard", r.modules), quotas: r.quotas ?? {},
  effectiveQuotas: effectiveQuotas(r.plan ?? "standard", r.quotas ?? {}), population: r.population ? Number(r.population) : undefined,
  contact: r.contact ?? {}, provisionLog: r.provision_log ?? [],
});

// ---------------------------------------------------------------- routes (via api-gateway)
app.get("/tenants", async (req: any) => {
  const c = ctx(req);
  const scope = c.roles.includes("super_admin") ? "*" : c.tenantId;
  const rows = await withTenant(scope, async (db) => (await db.query("select * from tenant.tenants order by id")).rows);
  return rows.map(publicTenant);
});

app.get("/tenants/:id", async (req: any) => {
  const c = ctx(req);
  if (!c.roles.includes("super_admin") && c.tenantId !== req.params.id) throw new HttpError(403, "Other tenant");
  const row = await withTenant(req.params.id, async (db) => (await db.query("select * from tenant.tenants where id=$1", [req.params.id])).rows[0]);
  if (!row) throw new HttpError(404, "Tenant not found");
  return publicTenant(row);
});

app.post("/tenants", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "super_admin");
  const body = TenantBody.parse(req.body);
  await createTenant(body);
  void provision(body.id).catch(() => undefined);
  let admin: string | undefined;
  if (body.adminUser) {
    try {
      await createCityUser(body.id, { ...body.adminUser, role: "city_admin", temporary: true });
      admin = body.adminUser.username;
      await step(body.id, `First City Admin created: ${admin} (temporary password, change on first login)`);
    } catch (err) { await step(body.id, `City Admin not created: ${(err as Error).message}`, false); }
  }
  await audit({ tenantId: body.id, actor: c.userId, action: "tenant.created", resource: `tenant/${body.id}`, data: { plan: body.plan, admin } });
  return reply.code(202).send({ id: body.id, status: "provisioning", admin });
});

app.post("/tenants/:id/provision", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "super_admin");
  void provision(req.params.id).catch(() => undefined);
  return reply.code(202).send({ id: req.params.id, status: "provisioning" });
});

app.get("/tenants/:id/api-keys", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin", "it_ops");
  if (c.tenantId !== req.params.id && !c.roles.includes("super_admin")) throw new HttpError(403, "Other tenant");
  return withTenant(req.params.id, async (db) => (await db.query(
    "select id, name, prefix, scopes, created_by, created_at, revoked_at from tenant.api_keys where tenant_id=$1 order by created_at desc", [req.params.id])).rows);
});

app.post("/tenants/:id/api-keys", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin", "it_ops");
  if (c.tenantId !== req.params.id && !c.roles.includes("super_admin")) throw new HttpError(403, "Other tenant");
  const body = z.object({ name: z.string().min(2), scopes: z.array(z.enum(["telemetry:write"])).default(["telemetry:write"]) }).parse(req.body ?? {});
  const created = await createApiKey(req.params.id, body.name, body.scopes, c.userId);
  await audit({ tenantId: req.params.id, actor: c.userId, action: "apikey.created", resource: `apikey/${created.id}` });
  return reply.code(201).send({ ...created, note: "Store this key now; it is not shown again." });
});

app.delete("/tenants/:id/api-keys/:keyId", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin", "it_ops");
  await withTenant(req.params.id, (db) => db.query("update tenant.api_keys set revoked_at=now() where id=$1 and tenant_id=$2", [req.params.keyId, req.params.id]));
  await audit({ tenantId: req.params.id, actor: c.userId, action: "apikey.revoked", resource: `apikey/${req.params.keyId}` });
  return { revoked: true };
});

// ---------------------------------------------------------------- plans, entitlements, lifecycle (super admin)
app.get("/plans", async (req: any) => { ctx(req); return { plans: PLANS, modules: MODULES }; });

const PatchBody = z.object({
  name: z.string().min(2).optional(), cityName: z.string().min(2).optional(),
  status: z.enum(["active", "suspended"]).optional(), plan: z.enum(["starter", "standard", "enterprise"]).optional(),
  modules: z.array(z.string()).optional(), quotas: z.record(z.string(), z.number()).optional(), population: z.number().int().positive().optional(),
  zones: z.array(Zone).optional(), branding: z.record(z.string(), z.unknown()).optional(),
  contact: z.object({ name: z.string().optional(), email: z.string().optional(), phone: z.string().optional() }).optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
});

app.put("/tenants/:id", async (req: any) => {
  const c = ctx(req);
  const id = req.params.id;
  const b = PatchBody.parse(req.body);
  const superAdmin = c.roles.includes("super_admin");
  if (!superAdmin) {
    requireRole(c, "city_admin");
    if (c.tenantId !== id) throw new HttpError(403, "Other tenant");
    if (b.status || b.plan || b.modules || b.quotas || b.name) throw new HttpError(403, "Only the platform admin can change plan, modules, quotas, status or the authority name");
  }
  const row = await withTenant(id, async (db) => {
    const cur = (await db.query("select * from tenant.tenants where id=$1 for update", [id])).rows[0];
    if (!cur) throw new HttpError(404, "Tenant not found");
    const plan = b.plan ?? cur.plan;
    const sets: string[] = ["updated_at=now()"];
    const args: unknown[] = [id];
    const set = (col: string, v: unknown) => { args.push(v); sets.push(`${col}=$${args.length}`); };
    if (b.name) set("name", b.name);
    if (b.cityName) set("city_name", b.cityName);
    if (b.status) {
      if (b.status === "active" && !["suspended", "active"].includes(cur.status)) throw new HttpError(409, `Cannot resume a city that is ${cur.status}`);
      set("status", b.status);
    }
    if (b.plan) set("plan", b.plan);
    if (b.modules || b.plan) set("modules", effectiveModules(plan, b.modules ?? cur.modules));
    if (b.quotas) set("quotas", JSON.stringify(b.quotas));
    if (b.population) set("population", b.population);
    if (b.zones) set("zones", JSON.stringify(b.zones));
    if (b.branding) set("branding", JSON.stringify({ ...cur.branding, ...b.branding }));
    if (b.contact) set("contact", JSON.stringify(b.contact));
    if (b.center) set("center", JSON.stringify(b.center));
    return (await db.query(`update tenant.tenants set ${sets.join(", ")} where id=$1 returning *`, args)).rows[0];
  });
  await audit({ tenantId: id, actor: c.userId, action: b.status === "suspended" ? "tenant.suspended" : b.status === "active" ? "tenant.resumed" : "tenant.updated", resource: `tenant/${id}`, data: b });
  return publicTenant(row);
});

// ---------------------------------------------------------------- departments (category routing)
const toDept = (r: any) => ({ id: r.id, name: r.name, head: r.head ?? undefined, email: r.email ?? undefined, phone: r.phone ?? undefined, categories: r.categories });
app.get("/departments", async (req: any) => {
  const c = ctx(req);
  return withTenant(c.tenantId, async (db) => (await db.query("select * from tenant.departments order by name")).rows.map(toDept));
});
const DeptBody = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/).optional(), name: z.string().min(2), head: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), categories: z.array(z.string()).default([]) });
app.post("/departments", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  const b = DeptBody.parse(req.body);
  const id = b.id ?? b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  await withTenant(c.tenantId, (db) => db.query(
    `insert into tenant.departments (tenant_id, id, name, head, email, phone, categories) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (tenant_id, id) do update set name=excluded.name, head=excluded.head, email=excluded.email, phone=excluded.phone, categories=excluded.categories`,
    [c.tenantId, id, b.name, b.head ?? null, b.email ?? null, b.phone ?? null, b.categories]));
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "department.saved", resource: `department/${id}` });
  return reply.code(201).send({ id, ...b });
});
app.delete("/departments/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  await withTenant(c.tenantId, (db) => db.query("delete from tenant.departments where id=$1", [req.params.id]));
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "department.deleted", resource: `department/${req.params.id}` });
  return { deleted: true };
});

// ---------------------------------------------------------------- users & roles (Keycloak)
app.get("/users", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin", "it_ops");
  return listCityUsers(c.tenantId);
});
const UserBody = z.object({
  username: z.string().regex(/^[a-z0-9._-]{3,40}$/, "3-40 chars: a-z 0-9 . _ -"), email: z.string().email().optional(),
  firstName: z.string().optional(), lastName: z.string().optional(), role: z.enum(CITY_ROLES as [string, ...string[]]),
  department: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/).optional(),
});
app.post("/users", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  const b = UserBody.parse(req.body);
  const meta = await withTenant(c.tenantId, async (db) => (await db.query("select plan, quotas from tenant.tenants where id=$1", [c.tenantId])).rows[0]);
  const max = effectiveQuotas(meta?.plan ?? "standard", meta?.quotas ?? {}).users;
  const count = (await listCityUsers(c.tenantId)).length;
  if (count >= max) throw new HttpError(409, `User quota reached (${count}/${max}) for this city's plan`);
  const password = `Tmp-${randomSecret(6)}9!`;
  const id = await createCityUser(c.tenantId, { ...b, password, temporary: true });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "user.created", resource: `user/${id}`, data: { username: b.username, role: b.role } });
  return reply.code(201).send({ id, username: b.username, temporaryPassword: password, note: "Share this temporary password securely; the user must change it at first login." });
});
app.put("/users/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  const b = z.object({ role: z.enum(CITY_ROLES as [string, ...string[]]).optional(), enabled: z.boolean().optional() }).parse(req.body);
  if (!(await userInTenant(c.tenantId, req.params.id))) throw new HttpError(404, "User not in this city");
  if (b.role) await setRole(req.params.id, b.role);
  if (b.enabled !== undefined) await setEnabled(req.params.id, b.enabled);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "user.updated", resource: `user/${req.params.id}`, data: b });
  return { updated: true };
});
app.post("/users/:id/reset-password", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  if (!(await userInTenant(c.tenantId, req.params.id))) throw new HttpError(404, "User not in this city");
  const password = `Tmp-${randomSecret(6)}9!`;
  await resetPassword(req.params.id, password);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "user.password.reset", resource: `user/${req.params.id}` });
  return { temporaryPassword: password };
});

// ---------------------------------------------------------------- announcements (platform -> cities, city admin -> own city)
app.get("/announcements", async (req: any) => {
  const c = ctx(req);
  const all = req.query?.all === "true" && c.roles.includes("super_admin");
  return withTenant(all ? "*" : c.tenantId, async (db) => (await db.query(
    `select * from tenant.announcements ${all ? "" : "where starts_at <= now() and (ends_at is null or ends_at > now())"} order by starts_at desc limit 50`)).rows
    .map((r: any) => ({ id: r.id, tenantId: r.tenant_id, title: r.title, body: r.body ?? undefined, level: r.level, startsAt: r.starts_at, endsAt: r.ends_at ?? undefined, createdBy: r.created_by })));
});
app.post("/announcements", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  const b = z.object({ tenantId: z.string().default(""), title: z.string().min(3).max(160), body: z.string().max(2000).optional(), level: z.enum(["info", "warning", "critical"]).default("info"), hours: z.number().min(0.5).max(24 * 60).optional() }).parse(req.body);
  const target = c.roles.includes("super_admin") ? (b.tenantId || "*") : c.tenantId;
  const row = await withTenant(target, async (db) => (await db.query(
    `insert into tenant.announcements (tenant_id, title, body, level, ends_at, created_by)
     values ($1,$2,$3,$4, case when $5::float is null then null else now() + ($5::float * interval '1 hour') end, $6) returning id`,
    [target, b.title, b.body ?? null, b.level, b.hours ?? null, c.userName])).rows[0]);
  await audit({ tenantId: target === "*" ? "platform" : target, actor: c.userId, action: "announcement.created", resource: `announcement/${row.id}` });
  return reply.code(201).send({ id: row.id, tenantId: target });
});
app.delete("/announcements/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  await withTenant(c.roles.includes("super_admin") ? "*" : c.tenantId, (db) => db.query("update tenant.announcements set ends_at=now() where id=$1", [req.params.id]));
  return { ended: true };
});

// ---------------------------------------------------------------- internal (service-to-service)
app.post("/internal/api-keys/verify", async (req: any) => {
  const { key } = z.object({ key: z.string().min(16) }).parse(req.body);
  const row = await withTenant("*", async (db) => (await db.query(
    "select k.id, k.tenant_id, k.scopes from tenant.api_keys k join tenant.tenants t on t.id = k.tenant_id where k.key_hash=$1 and k.revoked_at is null and t.status <> 'suspended'",
    [sha256(key)])).rows[0]);
  if (!row) throw new HttpError(401, "Invalid API key");
  return { tenantId: row.tenant_id, keyId: row.id, scopes: row.scopes };
});

app.get("/internal/tenants", async () => {
  const rows = await withTenant("*", async (db) => (await db.query("select * from tenant.tenants where status in ('active','provisioning','pending') order by id")).rows);
  return rows.map(publicTenant);
});

/** Every city with status, plan, effective quotas and modules (gateway entitlement checks, asset quotas, platform usage). */
app.get("/internal/tenants/all", async () => {
  const rows = await withTenant("*", async (db) => (await db.query("select * from tenant.tenants order by id")).rows);
  return rows.map(publicTenant);
});

app.get("/internal/departments/:id", async (req: any) => withTenant(req.params.id, async (db) => (await db.query("select * from tenant.departments")).rows.map(toDept)));

app.get("/internal/tenants/:id/tb-credentials", async (req: any) => {
  const row = await withTenant(req.params.id, async (db) => (await db.query("select tb_admin_email, tb_admin_password_enc, status from tenant.tenants where id=$1", [req.params.id])).rows[0]);
  if (!row?.tb_admin_password_enc) throw new HttpError(404, "Tenant not provisioned in ThingsBoard yet");
  return { email: row.tb_admin_email, password: decrypt(row.tb_admin_password_enc), status: row.status };
});

// ---------------------------------------------------------------- start
await waitFor("postgres", () => getPool().query("select 1"));
await listen(app);
logger.info("tenant-service ready");

if (env("SEED_DEMO", "true") === "true") {
  for (const t of DEMO_TENANTS) {
    await createTenant(t);
    await createApiKey(t.id, "Demo simulator key", ["telemetry:write"], "seed", env(t.apiKeyEnv, t.apiKeyDefault));
    const status = await withTenant(t.id, async (db) => (await db.query("select status from tenant.tenants where id=$1", [t.id])).rows[0]?.status);
    if (status !== "active") void provision(t.id).catch(() => undefined);
  }
  logger.info({ tenants: DEMO_TENANTS.map((t) => t.id) }, "demo tenants seeded");
}
