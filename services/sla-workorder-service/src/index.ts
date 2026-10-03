import { z } from "zod";
import {
  createApp, listen, ctx, requireRole, withTenant, runConsumer, publish, makeEvent, Topics, logger, audit,
  HttpError, waitFor, getPool, getRedis, env, envBool, internalHeaders, type EventEnvelope, type Persona,
} from "@scaas/common";
import {
  DEFAULT_POLICIES, deadlines, rag, checkpoints, parseCheckpoint, woNext, WO_ROLES, type Policy, type Severity,
} from "./sla.ts";

const INCIDENT_URL = env("INCIDENT_SERVICE_URL", "http://incident-service:3000");
const AUTO_RESOLVE_INCIDENT = envBool("AUTO_RESOLVE_INCIDENT_ON_WO_COMPLETE", false);
const ZSET = "sla:checkpoints";
const redis = getRedis();
const app = createApp({ internalOnly: true, ready: async () => { await getPool().query("select 1"); return true; } });

interface IncidentEvt { incident: { id: string; tenantId: string; ref: string; category: string; severity: Severity; status: string; createdAt: string; title: string; zone?: string; department?: string }; action?: string; actor?: string }

async function policyFor(tenantId: string, category: string, severity: Severity): Promise<Policy> {
  const row = await withTenant(tenantId, async (c) => (await c.query(
    `select * from sla.policies where tenant_id=$1 and severity=$2 and category in ($3,'*')
     order by case when category=$3 then 0 else 1 end limit 1`, [tenantId, severity, category])).rows[0]);
  if (!row) return DEFAULT_POLICIES[severity] ?? DEFAULT_POLICIES.Medium;
  return { responseMin: row.response_min, resolutionMin: row.resolution_min, amberPct: row.amber_pct, escalateTo: row.escalate_to, autoEscalate: row.auto_escalate };
}

async function schedule(tenantId: string, incidentId: string, createdAt: number, p: Policy, clocks: Array<"response" | "resolution">) {
  const d = deadlines(createdAt, p);
  const cps = checkpoints(tenantId, incidentId, d).filter(([, m]) => clocks.some((c) => m.includes(`|${c}|`)));
  if (cps.length) await redis.zadd(ZSET, ...cps.flatMap(([score, member]) => [score, member]));
  return d;
}

async function unschedule(tenantId: string, incidentId: string, clock: "response" | "resolution") {
  await redis.zrem(ZSET, `${tenantId}|${incidentId}|${clock}|amber`, `${tenantId}|${incidentId}|${clock}|red`);
}

// ---------------------------------------------------------------- incidents -> timers
async function onIncident(event: EventEnvelope<IncidentEvt>) {
  const { incident: i, action } = event.data;
  const t = event.tenantId;
  if (event.type === "incident.created" || action === "severity") {
    const p = await policyFor(t, i.category, i.severity);
    const created = Date.parse(i.createdAt);
    const d = await schedule(t, i.id, created, p, ["response", "resolution"]);
    await withTenant(t, (c) => c.query(
      `insert into sla.timers (incident_id, tenant_id, category, severity, created_at, response_due, resolution_due, escalate_to, auto_escalate)
       values ($1,$2,$3,$4,to_timestamp($5/1000.0),to_timestamp($6/1000.0),to_timestamp($7/1000.0),$8,$9)
       on conflict (incident_id) do update set severity=excluded.severity, response_due=excluded.response_due,
         resolution_due=excluded.resolution_due, escalate_to=excluded.escalate_to, auto_escalate=excluded.auto_escalate`,
      [i.id, t, i.category, i.severity, created, d.responseDue, d.resolutionDue, p.escalateTo, p.autoEscalate]));
    return;
  }
  if (action === "acknowledge" || action === "assign") {
    await withTenant(t, (c) => c.query("update sla.timers set response_met_at=coalesce(response_met_at, now()) where incident_id=$1", [i.id]));
    await unschedule(t, i.id, "response");
  }
  if (action === "resolve" || action === "close") {
    await withTenant(t, (c) => c.query(
      "update sla.timers set response_met_at=coalesce(response_met_at, now()), resolution_met_at=coalesce(resolution_met_at, now()) where incident_id=$1", [i.id]));
    await unschedule(t, i.id, "response");
    await unschedule(t, i.id, "resolution");
  }
  if (action === "reopen") {
    const row = await withTenant(t, async (c) => (await c.query("update sla.timers set resolution_met_at=null, resolution_status='green' where incident_id=$1 returning *", [i.id])).rows[0]);
    if (row) {
      const due = new Date(row.resolution_due).getTime();
      await redis.zadd(ZSET, Math.max(Date.now(), due - 1), `${t}|${i.id}|resolution|amber`, due, `${t}|${i.id}|resolution|red`);
    }
  }
}

/** Every 5 s: fire due checkpoints. ZREM decides ownership so several replicas never double-fire. */
async function tick() {
  const due: string[] = await redis.zrangebyscore(ZSET, "-inf", Date.now(), "LIMIT", 0, 200);
  for (const member of due) {
    if ((await redis.zrem(ZSET, member)) !== 1) continue;
    const cp = parseCheckpoint(member);
    const timer = await withTenant(cp.tenantId, async (c) => (await c.query(
      `update sla.timers set ${cp.clock}_status=$2 ${cp.level === "red" ? `, ${cp.clock}_breached=true` : ""}
       where incident_id=$1 and ${cp.clock}_met_at is null returning *`, [cp.incidentId, cp.level])).rows[0]);
    if (!timer) continue; // met in the meantime
    await publish(Topics.sla, makeEvent({
      type: cp.level === "red" ? "sla.breached" : "sla.amber",
      tenantId: cp.tenantId, source: "sla-workorder-service",
      entity: { type: "INCIDENT", id: cp.incidentId },
      data: { incidentId: cp.incidentId, clock: cp.clock, level: cp.level, severity: timer.severity, category: timer.category, escalateTo: timer.escalate_to, dueAt: timer[`${cp.clock}_due`] },
    }));
    if (cp.level === "red" && timer.auto_escalate) {
      await fetch(`${INCIDENT_URL}/incidents/${cp.incidentId}/transition`, {
        method: "POST",
        headers: internalHeaders({ "x-tenant-id": cp.tenantId, "x-user-id": "sla-engine", "x-user-name": "SLA engine", "x-user-roles": "city_admin" }),
        body: JSON.stringify({ action: "escalate", note: `${cp.clock} SLA breached; escalated to ${timer.escalate_to}` }),
      }).catch((err) => logger.warn({ err }, "auto-escalation call failed"));
    }
  }
}

// ---------------------------------------------------------------- SLA API
app.get("/sla/summary", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "leadership", "analyst", "city_admin", "it_ops");
  return withTenant(c.tenantId, async (db) => {
    const now = Date.now();
    const rows = (await db.query("select * from sla.timers where resolution_met_at is null or resolution_met_at > now() - interval '30 days'")).rows;
    const open = { green: 0, amber: 0, red: 0 };
    let resolved = 0, resolvedInSla = 0, responded = 0, respondedInSla = 0;
    for (const r of rows) {
      const p = { rd: new Date(r.response_due).getTime(), sd: new Date(r.resolution_due).getTime(), created: new Date(r.created_at).getTime() };
      if (!r.resolution_met_at) {
        const amberAt = p.created + (p.sd - p.created) * 0.75;
        const s = rag(now, amberAt, p.sd) as "green" | "amber" | "red";
        const rs = r.response_met_at ? "green" : rag(now, p.created + (p.rd - p.created) * 0.75, p.rd);
        const worst = [s, rs].includes("red") ? "red" : [s, rs].includes("amber") ? "amber" : "green";
        open[worst as "green" | "amber" | "red"]++;
      } else {
        resolved++;
        if (new Date(r.resolution_met_at).getTime() <= p.sd) resolvedInSla++;
      }
      if (r.response_met_at) {
        responded++;
        if (new Date(r.response_met_at).getTime() <= p.rd) respondedInSla++;
      }
    }
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 100);
    return { open, responseCompliancePct: pct(respondedInSla, responded), resolutionCompliancePct: pct(resolvedInSla, resolved), window: "30d" };
  });
});

app.get("/sla/timers", async (req: any) => {
  const c = ctx(req);
  const ids = String(req.query?.incidentIds ?? "").split(",").filter(Boolean);
  if (!ids.length) return [];
  const now = Date.now();
  const rows = await withTenant(c.tenantId, async (db) => (await db.query("select * from sla.timers where incident_id = any($1::uuid[])", [ids])).rows);
  return rows.map((r: any) => {
    const created = new Date(r.created_at).getTime(), rd = new Date(r.response_due).getTime(), sd = new Date(r.resolution_due).getTime();
    return {
      incidentId: r.incident_id, responseDue: r.response_due, resolutionDue: r.resolution_due,
      response: rag(now, created + (rd - created) * 0.75, rd, r.response_met_at ? new Date(r.response_met_at).getTime() : null),
      resolution: rag(now, created + (sd - created) * 0.75, sd, r.resolution_met_at ? new Date(r.resolution_met_at).getTime() : null),
    };
  });
});

app.get("/sla/policies", async (req: any) => {
  const c = ctx(req);
  const rows = await withTenant(c.tenantId, async (db) => (await db.query("select * from sla.policies order by category, severity")).rows);
  return { defaults: DEFAULT_POLICIES, overrides: rows };
});

const PolicyBody = z.array(z.object({
  category: z.string().min(1), severity: z.enum(["Critical", "High", "Medium", "Low"]),
  responseMin: z.number().int().positive(), resolutionMin: z.number().int().positive(),
  amberPct: z.number().int().min(10).max(99).default(75), escalateTo: z.string().default(""), autoEscalate: z.boolean().default(false),
}));

app.put("/sla/policies", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  const list = PolicyBody.parse(req.body);
  await withTenant(c.tenantId, async (db) => {
    for (const p of list) {
      await db.query(
        `insert into sla.policies (tenant_id, category, severity, response_min, resolution_min, amber_pct, escalate_to, auto_escalate)
         values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id, category, severity) do update set
         response_min=excluded.response_min, resolution_min=excluded.resolution_min, amber_pct=excluded.amber_pct,
         escalate_to=excluded.escalate_to, auto_escalate=excluded.auto_escalate`,
        [c.tenantId, p.category, p.severity, p.responseMin, p.resolutionMin, p.amberPct, p.escalateTo, p.autoEscalate]);
    }
  });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "sla.policies.updated", resource: "sla/policies", data: { count: list.length } });
  return { updated: list.length };
});

// ---------------------------------------------------------------- work orders
const toWo = (r: any) => ({
  id: r.id, ref: `WO-${String(r.number).padStart(6, "0")}`, incidentId: r.incident_id ?? undefined, title: r.title,
  description: r.description ?? undefined, status: r.status, priority: r.priority, department: r.department ?? undefined,
  assignee: r.assignee ?? undefined, dueAt: r.due_at ?? undefined, checklist: r.checklist, evidence: r.evidence,
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at ?? undefined,
});

async function emitWo(type: string, tenantId: string, wo: ReturnType<typeof toWo>, actor: string, extra: Record<string, unknown> = {}) {
  await publish(Topics.workOrders, makeEvent({ type, tenantId, source: "sla-workorder-service", entity: { type: "WORK_ORDER", id: wo.id, name: wo.ref }, data: { workOrder: wo, actor, ...extra } }));
}

app.get("/work-orders", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "field_tech", "city_admin", "leadership", "analyst");
  const q = req.query ?? {};
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace("?", `$${args.length}`)); };
  const onlyTech = c.roles.includes("field_tech") && !c.roles.some((r) => ["operator", "dept_head", "city_admin", "super_admin"].includes(r));
  if (onlyTech || q.assignee === "me") add("assignee = ?", c.userName);
  else if (q.assignee) add("assignee = ?", q.assignee);
  if (q.status) add("status = any(string_to_array(?, ','))", q.status);
  if (q.incidentId) add("incident_id = ?::uuid", q.incidentId);
  if (q.department) add("department = ?", q.department);
  const rows = await withTenant(c.tenantId, async (db) => (await db.query(
    `select * from sla.work_orders ${where.length ? `where ${where.join(" and ")}` : ""} order by created_at desc limit 200`, args)).rows);
  return rows.map(toWo);
});

app.get("/work-orders/:id", async (req: any) => {
  const c = ctx(req);
  return withTenant(c.tenantId, async (db) => {
    const r = (await db.query("select * from sla.work_orders where id=$1", [req.params.id])).rows[0];
    if (!r) throw new HttpError(404, "Work order not found");
    const events = (await db.query("select type, actor, data, at from sla.work_order_events where work_order_id=$1 order by at", [r.id])).rows;
    return { ...toWo(r), timeline: events };
  });
});

const WoBody = z.object({
  incidentId: z.string().uuid().optional(),
  title: z.string().min(3).max(200),
  description: z.string().max(4000).optional(),
  priority: z.enum(["Critical", "High", "Medium", "Low"]).default("Medium"),
  department: z.string().optional(),
  assignee: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  checklist: z.array(z.object({ item: z.string(), done: z.boolean().default(false) })).default([]),
});

app.post("/work-orders", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "city_admin");
  const b = WoBody.parse(req.body);
  const wo = await withTenant(c.tenantId, async (db) => {
    const r = (await db.query(
      `insert into sla.work_orders (tenant_id, incident_id, title, description, status, priority, department, assignee, due_at, checklist, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [c.tenantId, b.incidentId ?? null, b.title, b.description ?? null, b.assignee ? "Assigned" : "Open", b.priority,
        b.department ?? null, b.assignee ?? null, b.dueAt ?? null, JSON.stringify(b.checklist), c.userName])).rows[0];
    await db.query("insert into sla.work_order_events (tenant_id, work_order_id, type, actor, data) values ($1,$2,'created',$3,$4)",
      [c.tenantId, r.id, c.userName, JSON.stringify({ assignee: b.assignee })]);
    return toWo(r);
  });
  await emitWo("workorder.created", c.tenantId, wo, c.userId);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "workorder.created", resource: `workorder/${wo.id}` });
  return reply.code(201).send(wo);
});

const WoTransition = z.object({
  action: z.enum(["assign", "accept", "start", "hold", "resume", "complete", "verify", "reject", "close", "cancel"]),
  assignee: z.string().optional(),
  note: z.string().max(2000).optional(),
  evidence: z.array(z.object({ type: z.enum(["photo", "document", "reading"]), url: z.string().optional(), value: z.string().optional() })).optional(),
  checklist: z.array(z.object({ item: z.string(), done: z.boolean() })).optional(),
});

app.post("/work-orders/:id/transition", async (req: any) => {
  const c = ctx(req);
  const b = WoTransition.parse(req.body);
  requireRole(c, ...(WO_ROLES[b.action] as Persona[]));
  const wo = await withTenant(c.tenantId, async (db) => {
    const r = (await db.query("select * from sla.work_orders where id=$1 for update", [req.params.id])).rows[0];
    if (!r) throw new HttpError(404, "Work order not found");
    if (c.roles.includes("field_tech") && !c.roles.includes("dept_head") && r.assignee !== c.userName) throw new HttpError(403, "Not your work order");
    let to: string;
    try { to = woNext(r.status, b.action); } catch (e) { throw new HttpError(409, (e as Error).message); }
    if (b.action === "assign" && !b.assignee) throw new HttpError(400, "assign needs assignee");
    const u = (await db.query(
      `update sla.work_orders set status=$2, assignee=coalesce($3, assignee), checklist=coalesce($4, checklist),
         evidence = evidence || coalesce($5, '[]'::jsonb), completed_at = case when $2='Completed' then now() else completed_at end, updated_at=now()
       where id=$1 returning *`,
      [r.id, to, b.assignee ?? null, b.checklist ? JSON.stringify(b.checklist) : null, b.evidence ? JSON.stringify(b.evidence) : null])).rows[0];
    await db.query("insert into sla.work_order_events (tenant_id, work_order_id, type, actor, data) values ($1,$2,$3,$4,$5)",
      [c.tenantId, r.id, b.action, c.userName, JSON.stringify({ from: r.status, to, note: b.note, assignee: b.assignee })]);
    return toWo(u);
  });
  await emitWo("workorder.updated", c.tenantId, wo, c.userId, { action: b.action });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: `workorder.${b.action}`, resource: `workorder/${wo.id}` });
  if (AUTO_RESOLVE_INCIDENT && b.action === "complete" && wo.incidentId) {
    await fetch(`${INCIDENT_URL}/incidents/${wo.incidentId}/transition`, {
      method: "POST",
      headers: internalHeaders({ "x-tenant-id": c.tenantId, "x-user-id": c.userId, "x-user-name": c.userName, "x-user-roles": "operator" }),
      body: JSON.stringify({ action: "resolve", note: `Work order ${wo.ref} completed` }),
    }).catch((err) => logger.warn({ err }, "incident auto-resolve failed"));
  }
  return wo;
});

// ---------------------------------------------------------------- start
await waitFor("postgres", () => getPool().query("select 1"));
await waitFor("kafka", () => runConsumer<IncidentEvt>({ groupId: "sla-workorder-service", topics: [Topics.incidents], handler: onIncident }));
setInterval(() => { tick().catch((err) => logger.error({ err }, "SLA tick failed")); }, 5000);
await listen(app);
logger.info("sla-workorder-service ready");
