import { createApp, listen, ctx, requireRole, withTenant, runConsumer, Topics, logger, waitFor, getPool, type EventEnvelope } from "@scaas/common";

const app = createApp({ internalOnly: true });

interface AuditData { actor: string; action: string; resource: string; ip?: string; [k: string]: unknown }

async function onAudit(e: EventEnvelope<AuditData>) {
  const { actor, action, resource, ip, ...rest } = e.data;
  await withTenant(e.tenantId, (c) => c.query(
    `insert into audit.audit_log (event_id, tenant_id, actor, action, resource, source, ip, data, at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (event_id) do nothing`,
    [e.eventId, e.tenantId, actor, action, resource, e.source, ip ?? null, JSON.stringify(rest), e.occurredAt]));
}

app.get("/audit", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "it_ops", "city_admin");
  const q = req.query ?? {};
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace("?", `$${args.length}`)); };
  if (q.actor) add("actor = ?", q.actor);
  if (q.action) add("action like ?", `${q.action}%`);
  if (q.resource) add("resource like ?", `${q.resource}%`);
  if (q.from) add("at >= ?::timestamptz", q.from);
  if (q.to) add("at <= ?::timestamptz", q.to);
  const scope = c.roles.includes("super_admin") && q.allTenants === "true" ? "*" : c.tenantId;
  return withTenant(scope, async (db) => (await db.query(
    `select tenant_id, actor, action, resource, source, ip, data, at from audit.audit_log
     ${where.length ? `where ${where.join(" and ")}` : ""} order by at desc limit ${Math.min(Number(q.limit ?? 200), 1000)}`, args)).rows);
});

await waitFor("postgres", () => getPool().query("select 1"));
await waitFor("kafka", () => runConsumer<AuditData>({ groupId: "audit-service", topics: [Topics.audit], handler: onAudit }));
await listen(app);
logger.info("audit-service ready");
