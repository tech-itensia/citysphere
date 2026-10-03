import { z } from "zod";
import {
  createApp, listen, ctx, requireRole, withTenant, env, HttpError, logger, audit, sha256, waitFor, getPool,
} from "@scaas/common";
import { TbClient, ensureTbTenant, provisionTenant } from "@scaas/thingsboard";
import { encrypt, decrypt, randomSecret } from "./secrets.ts";
import { DEMO_TENANTS } from "./demo.ts";

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
});
type TenantInput = z.infer<typeof TenantBody>;

const app = createApp({ internalOnly: true, ready: async () => { await getPool().query("select 1"); return true; } });

// ---------------------------------------------------------------- provisioning
async function provision(tenantId: string): Promise<void> {
  const row = await withTenant(tenantId, async (c) => (await c.query("select * from tenant.tenants where id=$1", [tenantId])).rows[0]);
  if (!row) throw new HttpError(404, "Tenant not found");
  try {
    await withTenant(tenantId, (c) => c.query("update tenant.tenants set status='provisioning', error=null, updated_at=now() where id=$1", [tenantId]));
    const email: string = row.tb_admin_email ?? `scaas-${tenantId}@tenants.scaas.local`;
    const password: string = row.tb_admin_password_enc ? decrypt(row.tb_admin_password_enc) : randomSecret();
    const { tbTenantId } = await waitFor("thingsboard", () => ensureTbTenant(sysadmin, { title: `SCaaS ${row.name}`, adminEmail: email, adminPassword: password }), 120, 5000);
    await withTenant(tenantId, (c) => c.query(
      "update tenant.tenants set tb_tenant_id=$2, tb_admin_email=$3, tb_admin_password_enc=$4, updated_at=now() where id=$1",
      [tenantId, tbTenantId, email, encrypt(password)]));
    const tb = new TbClient(TB_URL, email, password);
    await provisionTenant(tb, { scaasTenantId: tenantId, cityName: row.city_name, center: row.center, zones: row.zones }, KAFKA_FOR_TB);
    await withTenant(tenantId, (c) => c.query("update tenant.tenants set status='active', updated_at=now() where id=$1", [tenantId]));
    logger.info({ tenantId, tbTenantId }, "tenant provisioned");
  } catch (err) {
    logger.error({ err, tenantId }, "tenant provisioning failed");
    await withTenant(tenantId, (c) => c.query("update tenant.tenants set status='failed', error=$2, updated_at=now() where id=$1", [tenantId, (err as Error).message.slice(0, 1000)]));
    throw err;
  }
}

async function createTenant(t: TenantInput): Promise<void> {
  await withTenant(t.id, (c) => c.query(
    `insert into tenant.tenants (id, name, city_name, center, zones, branding, status)
     values ($1,$2,$3,$4,$5,$6,'pending') on conflict (id) do nothing`,
    [t.id, t.name, t.cityName, JSON.stringify(t.center), JSON.stringify(t.zones), JSON.stringify(t.branding)]));
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
  await audit({ tenantId: body.id, actor: c.userId, action: "tenant.created", resource: `tenant/${body.id}` });
  return reply.code(202).send({ id: body.id, status: "provisioning" });
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
