import { z } from "zod";
import {
  createApp, listen, ctx, requireRole, withTenant, runConsumer, publish, makeEvent, Topics, logger, audit,
  HttpError, waitFor, getPool, envBool, type EventEnvelope, type AlarmData, type Persona,
} from "@scaas/common";
import { deviceTypeByName } from "@scaas/thingsboard";
import {
  nextStatus, mapSeverity, isDuplicate, ACTION_ROLES, CATEGORY_DEPARTMENT, SEVERITY_RANK, TransitionError,
  type Action, type Severity,
} from "./lifecycle.ts";
import { insertIncident, addEvent, getIncident, toIncident, deviceLocation, type Incident } from "./repo.ts";

const AUTO_RESOLVE_ON_CLEAR = envBool("AUTO_RESOLVE_ON_CLEAR", true);
const app = createApp({ internalOnly: true, ready: async () => { await getPool().query("select 1"); return true; } });

async function emit(type: string, incident: Incident, actor: string, extra: Record<string, unknown> = {}) {
  await publish(Topics.incidents, makeEvent({
    type, tenantId: incident.tenantId, source: "incident-service",
    entity: { type: "INCIDENT", id: incident.id, name: incident.ref },
    data: { incident, actor, ...extra },
  }));
}

// ---------------------------------------------------------------- alarms -> incidents
async function onAlarm(event: EventEnvelope<AlarmData>): Promise<void> {
  const a = event.data;
  const tenantId = event.tenantId;
  const category = deviceTypeByName(a.deviceType ?? "")?.domain ?? "generic";
  const severity = mapSeverity(a.severity);

  const result = await withTenant(tenantId, async (c) => {
    const byAlarm = (await c.query("select * from incident.incidents where alarm_id=$1 order by created_at desc limit 1 for update", [a.alarmId])).rows[0];

    if (event.type === "alarm.cleared") {
      if (!byAlarm) return undefined;
      const inc = toIncident(byAlarm);
      await c.query("update incident.incidents set source_cleared=true, updated_at=now() where id=$1", [inc.id]);
      await addEvent(c, tenantId, inc.id, "source.cleared", "thingsboard", { alarmType: a.alarmType });
      if (AUTO_RESOLVE_ON_CLEAR && inc.status === "New") {
        await c.query("update incident.incidents set status='Resolved', resolved_at=now(), updated_at=now() where id=$1", [inc.id]);
        await addEvent(c, tenantId, inc.id, "status.changed", "system", { from: "New", to: "Resolved", action: "resolve", note: "Auto-resolved: source alarm cleared before acknowledgement" });
        return { type: "incident.updated", incident: (await getIncident(c, inc.id))!, action: "resolve" };
      }
      return undefined;
    }

    if (byAlarm) {
      const inc = toIncident(byAlarm);
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[inc.severity as Severity]) {
        await c.query("update incident.incidents set severity=$2, updated_at=now() where id=$1", [inc.id, severity]);
        await addEvent(c, tenantId, inc.id, "severity.raised", "thingsboard", { from: inc.severity, to: severity });
        return { type: "incident.updated", incident: (await getIncident(c, inc.id))!, action: "severity" };
      }
      return undefined;
    }

    const recent = (await c.query(
      "select * from incident.incidents where device_id=$1 and category=$2 and status in ('New','Acknowledged','Assigned','In Progress','Reopened') order by created_at desc limit 1",
      [a.deviceId, category])).rows[0];
    if (recent && isDuplicate({ deviceId: recent.device_id, category: recent.category, status: recent.status, createdAt: new Date(recent.created_at).getTime() }, { deviceId: a.deviceId, category, at: Date.now() })) {
      await addEvent(c, tenantId, recent.id, "alarm.merged", "thingsboard", { alarmId: a.alarmId, alarmType: a.alarmType, severity });
      return undefined;
    }

    const loc = await deviceLocation(tenantId, a.deviceId);
    const inc = await insertIncident(c, {
      tenantId, title: event.source === "correlation" ? a.alarmType : `${a.alarmType} at ${a.deviceId}`, category, severity,
      deviceId: a.deviceId, deviceType: a.deviceType, alarmId: a.alarmId, alarmType: a.alarmType,
      zone: loc.zone ?? (a.details?.zone as string | undefined), lat: loc.lat, lon: loc.lon, department: CATEGORY_DEPARTMENT[category],
      source: event.source === "correlation" ? "correlation" : "alarm",
      description: event.source === "correlation"
        ? `Correlated: ${((a.details?.evidence as string[]) ?? []).join("; ")}`
        : `Raised automatically by ThingsBoard alarm rule "${a.alarmType}" (${a.severity}).`,
    });
    await addEvent(c, tenantId, inc.id, "created", event.source, { alarmId: a.alarmId, tbSeverity: a.severity, details: a.details });
    return { type: "incident.created", incident: inc, action: "create" };
  });
  if (result) await emit(result.type, result.incident, "system", { action: result.action });
}

// ---------------------------------------------------------------- REST (via api-gateway)
const READ_ROLES: Persona[] = ["operator", "dept_head", "leadership", "analyst", "city_admin", "it_ops", "field_tech"];

app.get("/incidents", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES, "citizen");
  const q = req.query ?? {};
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace("?", `$${args.length}`)); };
  if (q.status) add("status = any(string_to_array(?, ','))", q.status);
  if (q.severity) add("severity = any(string_to_array(?, ','))", q.severity);
  if (q.category) add("category = ?", q.category);
  if (q.zone) add("zone = ?", q.zone);
  if (q.department) add("department = ?", q.department);
  if (q.open === "true") where.push("status in ('New','Acknowledged','Assigned','In Progress','Reopened')");
  if (c.roles.length === 1 && c.roles[0] === "citizen") add("reporter = ?", c.userId);
  const limit = Math.min(Number(q.limit ?? 100), 500);
  const offset = Number(q.offset ?? 0);
  const rows = await withTenant(c.tenantId, async (db) => (await db.query(
    `select * from incident.incidents ${where.length ? `where ${where.join(" and ")}` : ""}
     order by case severity when 'Critical' then 4 when 'High' then 3 when 'Medium' then 2 else 1 end desc, created_at desc
     limit ${limit} offset ${offset}`, args)).rows);
  return rows.map(toIncident);
});

app.get("/incidents/stats", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES);
  return withTenant(c.tenantId, async (db) => {
    const one = async (sql: string) => (await db.query(sql)).rows;
    const [totals] = await one(`select count(*)::int total,
        count(*) filter (where status in ('New','Acknowledged','Assigned','In Progress','Reopened'))::int open,
        count(*) filter (where created_at >= date_trunc('day', now()))::int today,
        round(avg(extract(epoch from (resolved_at - created_at))/60) filter (where resolved_at >= now() - interval '30 days'))::int mttr_minutes
      from incident.incidents`);
    const group = (col: string) => one(`select ${col} as key, count(*)::int as count from incident.incidents
        where status in ('New','Acknowledged','Assigned','In Progress','Reopened') group by ${col} order by 2 desc`);
    return {
      total: totals.total, open: totals.open, createdToday: totals.today, mttrMinutes: totals.mttr_minutes,
      bySeverity: await group("severity"), byStatus: await group("status"), byCategory: await group("category"), byZone: await group("coalesce(zone,'Unknown')"),
    };
  });
});

app.get("/incidents/trend", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES);
  const days = Math.min(Number(req.query?.days ?? 30), 365);
  return withTenant(c.tenantId, async (db) => (await db.query(
    `select d::date as day,
       (select count(*)::int from incident.incidents i where i.created_at::date = d::date) as created,
       (select count(*)::int from incident.incidents i where i.resolved_at::date = d::date) as resolved
     from generate_series(now()::date - ($1::int - 1), now()::date, interval '1 day') d order by 1`, [days])).rows);
});

app.get("/incidents/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES, "citizen");
  return withTenant(c.tenantId, async (db) => {
    const inc = await getIncident(db, req.params.id);
    if (!inc) throw new HttpError(404, "Incident not found");
    if (c.roles.length === 1 && c.roles[0] === "citizen" && inc.reporter !== c.userId) throw new HttpError(404, "Incident not found");
    const events = (await db.query("select type, actor, data, at from incident.incident_events where incident_id=$1 order by at", [inc.id])).rows;
    return { ...inc, timeline: events };
  });
});

const CreateBody = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().min(2),
  severity: z.enum(["Critical", "High", "Medium", "Low"]).default("Medium"),
  zone: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  deviceId: z.string().optional(),
});

app.post("/incidents", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "city_admin", "citizen");
  const b = CreateBody.parse(req.body);
  const isCitizen = c.roles.includes("citizen") && !c.roles.some((r) => r !== "citizen");
  const inc = await withTenant(c.tenantId, async (db) => {
    const created = await insertIncident(db, {
      tenantId: c.tenantId, title: b.title, description: b.description, category: b.category,
      severity: isCitizen ? "Medium" : b.severity, source: isCitizen ? "citizen" : "operator",
      zone: b.zone, lat: b.lat, lon: b.lon, deviceId: b.deviceId, reporter: c.userId,
      department: CATEGORY_DEPARTMENT[b.category] ?? "Operations",
    });
    await addEvent(db, c.tenantId, created.id, "created", c.userName, { source: created.source });
    return created;
  });
  await emit("incident.created", inc, c.userId, { action: "create" });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "incident.created", resource: `incident/${inc.id}` });
  return reply.code(201).send(inc);
});

const TransitionBody = z.object({
  action: z.enum(["acknowledge", "assign", "start", "resolve", "verify", "close", "reopen", "escalate"]),
  assignee: z.string().optional(),
  department: z.string().optional(),
  note: z.string().max(2000).optional(),
});

app.post("/incidents/:id/transition", async (req: any) => {
  const c = ctx(req);
  const b = TransitionBody.parse(req.body);
  requireRole(c, ...(ACTION_ROLES[b.action as Action] as Persona[]));
  const updated = await withTenant(c.tenantId, async (db) => {
    const inc = await getIncident(db, req.params.id, true);
    if (!inc) throw new HttpError(404, "Incident not found");
    let to;
    try { to = nextStatus(inc.status, b.action); } catch (e) {
      if (e instanceof TransitionError) throw new HttpError(409, e.message);
      throw e;
    }
    if (b.action === "assign" && !b.assignee && !b.department) throw new HttpError(400, "assign needs assignee or department");
    const sets = ["status=$2", "updated_at=now()"];
    const args: unknown[] = [inc.id, to];
    const set = (col: string, v: unknown) => { args.push(v); sets.push(`${col}=$${args.length}`); };
    if (b.action === "acknowledge") sets.push("acknowledged_at=coalesce(acknowledged_at, now())");
    if (b.action === "resolve") sets.push("resolved_at=now()");
    if (b.action === "close") sets.push("closed_at=now()");
    if (b.action === "reopen") sets.push("resolved_at=null, closed_at=null");
    if (b.action === "escalate") sets.push("escalation_level=escalation_level+1");
    if (b.assignee) set("assignee", b.assignee);
    if (b.department) set("department", b.department);
    await db.query(`update incident.incidents set ${sets.join(", ")} where id=$1`, args);
    await addEvent(db, c.tenantId, inc.id, b.action === "escalate" ? "escalated" : "status.changed", c.userName,
      { from: inc.status, to, action: b.action, assignee: b.assignee, department: b.department, note: b.note });
    return (await getIncident(db, inc.id))!;
  });
  await emit("incident.updated", updated, c.userId, { action: b.action, note: b.note });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: `incident.${b.action}`, resource: `incident/${updated.id}` });
  return updated;
});

app.post("/incidents/:id/comments", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES);
  const { note } = z.object({ note: z.string().min(1).max(2000) }).parse(req.body);
  await withTenant(c.tenantId, (db) => addEvent(db, c.tenantId, req.params.id, "comment", c.userName, { note }));
  return { ok: true };
});

// ---------------------------------------------------------------- start
await waitFor("postgres", () => getPool().query("select 1"));
await waitFor("kafka", () => runConsumer<AlarmData>({ groupId: "incident-service", topics: [Topics.alerts], handler: onAlarm }));
await listen(app);
logger.info("incident-service ready");
