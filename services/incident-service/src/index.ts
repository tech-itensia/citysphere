import { z } from "zod";
import {
  createApp, listen, ctx, requireRole, withTenant, runConsumer, publish, makeEvent, Topics, logger, audit,
  HttpError, waitFor, getPool, envBool, env, internalHeaders, inc, SUPPRESSED_STATUSES,
  type EventEnvelope, type AlarmData, type Persona, type DeviceStatus,
} from "@scaas/common";
import { deviceTypeByName } from "@scaas/thingsboard";
import {
  nextStatus, mapSeverity, isDuplicate, allowedActions, ACTION_ROLES, ACTIONS, CITIZEN_ACTIONS, CATEGORY_DEPARTMENT, CLOSURE_CODES,
  SEVERITY_RANK, OPEN_SQL, TransitionError, type Action, type Severity,
} from "./lifecycle.ts";
import { insertIncident, addEvent, getIncident, toIncident, deviceContext, type Incident } from "./repo.ts";

const AUTO_RESOLVE_ON_CLEAR = envBool("AUTO_RESOLVE_ON_CLEAR", true);
const TENANT_URL = env("TENANT_SERVICE_URL", "http://tenant-service:3000");
const app = createApp({ internalOnly: true, ready: async () => { await getPool().query("select 1"); return true; }, bodyLimit: 8 * 1024 * 1024 });

async function emit(type: string, incident: Incident, actor: string, extra: Record<string, unknown> = {}) {
  await publish(Topics.incidents, makeEvent({
    type, tenantId: incident.tenantId, source: "incident-service",
    entity: { type: "INCIDENT", id: incident.id, name: incident.ref },
    data: { incident, actor, ...extra },
  }));
}

// ---------------------------------------------------------------- department routing (city rules from tenant-service, cached)
const routing = new Map<string, { at: number; rules: Array<{ name: string; categories: string[] }> }>();
async function departmentFor(tenantId: string, category: string, registryDept?: string): Promise<string> {
  if (registryDept) return registryDept;
  let hit = routing.get(tenantId);
  if (!hit || Date.now() - hit.at > 60_000) {
    try {
      const res = await fetch(`${TENANT_URL}/internal/departments/${tenantId}`, { headers: internalHeaders() });
      hit = { at: Date.now(), rules: res.ok ? ((await res.json()) as any[]) : [] };
      routing.set(tenantId, hit);
    } catch { hit = { at: Date.now(), rules: [] }; }
  }
  return hit.rules.find((d) => d.categories?.includes(category))?.name ?? CATEGORY_DEPARTMENT[category] ?? "Operations";
}

// ---------------------------------------------------------------- alarms -> incidents
async function onAlarm(event: EventEnvelope<AlarmData>): Promise<void> {
  const a = event.data;
  const tenantId = event.tenantId;
  const category = deviceTypeByName(a.deviceType ?? "")?.domain ?? (a.details?.category as string | undefined) ?? "generic";
  const severity = mapSeverity(a.severity);
  const dev = a.deviceId ? await deviceContext(tenantId, a.deviceId) : {};

  // planned maintenance / retired devices never page the command centre
  if (event.type === "alarm.raised" && dev.status && SUPPRESSED_STATUSES.includes(dev.status as DeviceStatus)) {
    inc("incident_alarms_suppressed_total", { tenant: tenantId, status: dev.status });
    return;
  }
  const department = await departmentFor(tenantId, category, dev.department);

  const result = await withTenant(tenantId, async (c) => {
    const byAlarm = (await c.query("select * from incident.incidents where alarm_id=$1 order by created_at desc limit 1 for update", [a.alarmId])).rows[0];

    if (event.type === "alarm.cleared") {
      if (!byAlarm) return undefined;
      const inc0 = toIncident(byAlarm);
      await c.query("update incident.incidents set source_cleared=true, updated_at=now() where id=$1", [inc0.id]);
      await addEvent(c, tenantId, inc0.id, "source.cleared", "thingsboard", { alarmType: a.alarmType });
      if (AUTO_RESOLVE_ON_CLEAR && inc0.status === "New") {
        await c.query("update incident.incidents set status='Resolved', resolved_at=now(), updated_at=now() where id=$1", [inc0.id]);
        await addEvent(c, tenantId, inc0.id, "status.changed", "system", { from: "New", to: "Resolved", action: "resolve", note: "Auto-resolved: source alarm cleared before acknowledgement" });
        return { type: "incident.updated", incident: (await getIncident(c, inc0.id))!, action: "resolve" };
      }
      return undefined;
    }

    if (byAlarm) {
      const cur = toIncident(byAlarm);
      if (SEVERITY_RANK[severity] > SEVERITY_RANK[cur.severity as Severity]) {
        await c.query("update incident.incidents set severity=$2, updated_at=now() where id=$1", [cur.id, severity]);
        await addEvent(c, tenantId, cur.id, "severity.raised", "thingsboard", { from: cur.severity, to: severity });
        return { type: "incident.updated", incident: (await getIncident(c, cur.id))!, action: "severity" };
      }
      return undefined;
    }

    const recent = (await c.query(
      `select * from incident.incidents where device_id=$1 and category=$2 and status in (${OPEN_SQL}) order by created_at desc limit 1`,
      [a.deviceId, category])).rows[0];
    if (recent && isDuplicate({ deviceId: recent.device_id, category: recent.category, status: recent.status, createdAt: new Date(recent.created_at).getTime() }, { deviceId: a.deviceId, category, at: Date.now() })) {
      await addEvent(c, tenantId, recent.id, "alarm.merged", "thingsboard", { alarmId: a.alarmId, alarmType: a.alarmType, severity });
      return undefined;
    }

    const correlated = event.source === "correlation";
    const created = await insertIncident(c, {
      tenantId, title: correlated ? a.alarmType : `${a.alarmType} at ${a.deviceId}`, category, severity,
      deviceId: a.deviceId, deviceType: a.deviceType, alarmId: a.alarmId, alarmType: a.alarmType,
      zone: dev.zone ?? (a.details?.zone as string | undefined), lat: dev.lat, lon: dev.lon, department, site: dev.site, asset: dev.asset,
      source: correlated ? "correlation" : "alarm",
      description: correlated
        ? `Correlated: ${((a.details?.evidence as string[]) ?? []).join("; ")}`
        : `Raised automatically by ThingsBoard alarm rule "${a.alarmType}" (${a.severity}).`,
    });
    await addEvent(c, tenantId, created.id, "created", event.source, { alarmId: a.alarmId, tbSeverity: a.severity, details: a.details });
    return { type: "incident.created", incident: created, action: "create" };
  });
  if (result) await emit(result.type, result.incident, "system", { action: result.action });
}

// ---------------------------------------------------------------- REST (via api-gateway)
const READ_ROLES: Persona[] = ["operator", "dept_head", "leadership", "analyst", "city_admin", "it_ops", "field_tech"];
const onlyCitizen = (roles: Persona[]) => roles.length > 0 && roles.every((r) => r === "citizen");

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
  if (q.deviceId) add("device_id = ?", q.deviceId);
  if (q.source) add("source = any(string_to_array(?, ','))", q.source);
  if (q.assignee) add("assignee = ?", q.assignee === "me" ? c.userName : q.assignee);
  if (q.since) add("created_at >= ?::timestamptz", q.since);
  if (q.escalated === "true") where.push("(escalation_level > 0 or status = 'Escalated')");
  if (q.open === "true") where.push(`status in (${OPEN_SQL})`);
  if (onlyCitizen(c.roles) || q.mine === "true") add("reporter = ?", c.userId);
  const limit = Math.min(Number(q.limit ?? 100), 1000);
  const offset = Number(q.offset ?? 0);
  const order = q.sort === "recent" ? "created_at desc"
    : "case severity when 'Critical' then 4 when 'High' then 3 when 'Medium' then 2 else 1 end desc, created_at desc";
  const rows = await withTenant(c.tenantId, async (db) => (await db.query(
    `select * from incident.incidents ${where.length ? `where ${where.join(" and ")}` : ""} order by ${order} limit ${limit} offset ${offset}`, args)).rows);
  return rows.map(toIncident).map((i) => (onlyCitizen(c.roles) ? { ...i, assignee: undefined, alarmId: undefined } : i));
});

app.get("/incidents/stats", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES);
  const dept = req.query?.department as string | undefined;
  return withTenant(c.tenantId, async (db) => {
    const scope = dept ? "where department = $1" : "";
    const args = dept ? [dept] : [];
    const one = async (sql: string) => (await db.query(sql, args)).rows;
    const [totals] = await one(`select count(*)::int total,
        count(*) filter (where status in (${OPEN_SQL}))::int open,
        count(*) filter (where created_at >= date_trunc('day', now()))::int today,
        count(*) filter (where status = 'Escalated' or (escalation_level > 0 and status in (${OPEN_SQL})))::int escalated,
        count(*) filter (where status = 'New')::int unacknowledged,
        count(*) filter (where source = 'citizen' and status in (${OPEN_SQL}))::int citizen_open,
        round(avg(extract(epoch from (acknowledged_at - created_at))/60) filter (where acknowledged_at >= now() - interval '30 days'))::int mtta_minutes,
        round(avg(extract(epoch from (resolved_at - created_at))/60) filter (where resolved_at >= now() - interval '30 days'))::int mttr_minutes
      from incident.incidents ${scope}`);
    const group = (col: string) => one(`select ${col} as key, count(*)::int as count from incident.incidents
        where status in (${OPEN_SQL}) ${dept ? "and department = $1" : ""} group by ${col} order by 2 desc`);
    return {
      total: totals.total, open: totals.open, createdToday: totals.today, escalated: totals.escalated, unacknowledged: totals.unacknowledged,
      citizenOpen: totals.citizen_open, mttaMinutes: totals.mtta_minutes, mttrMinutes: totals.mttr_minutes,
      bySeverity: await group("severity"), byStatus: await group("status"), byCategory: await group("category"),
      byZone: await group("coalesce(zone,'Unknown')"), byDepartment: await group("coalesce(department,'Unassigned')"),
      bySource: await group("source"), byAssignee: await group("coalesce(assignee,'Unassigned')"),
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

/** Department scorecard for leadership / analytics: volume, MTTR, SLA-relevant counts per department (30 days). */
app.get("/incidents/departments", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES);
  return withTenant(c.tenantId, async (db) => (await db.query(
    `select coalesce(department,'Unassigned') department,
       count(*)::int total,
       count(*) filter (where status in (${OPEN_SQL}))::int open,
       count(*) filter (where status in ('Resolved','Closed'))::int resolved,
       count(*) filter (where status = 'Escalated' or escalation_level > 0)::int escalated,
       round(avg(extract(epoch from (resolved_at - created_at))/60) filter (where resolved_at is not null))::int mttr_minutes
     from incident.incidents where created_at >= now() - interval '30 days' group by 1 order by 2 desc`)).rows);
});

app.get("/incidents/:id", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES, "citizen");
  return withTenant(c.tenantId, async (db) => {
    const i = await getIncident(db, req.params.id);
    if (!i) throw new HttpError(404, "Incident not found");
    const citizen = onlyCitizen(c.roles);
    if (citizen && i.reporter !== c.userId) throw new HttpError(404, "Incident not found");
    const events = (await db.query("select type, actor, data, at from incident.incident_events where incident_id=$1 order by at", [i.id])).rows;
    const actions = allowedActions(i.status, c.roles).filter((a) => !citizen || CITIZEN_ACTIONS.includes(a));
    return {
      ...i, allowedActions: actions,
      timeline: citizen ? events.filter((e: any) => e.type !== "comment").map((e: any) => ({ ...e, actor: e.actor === c.userName ? "you" : "City team" })) : events,
    };
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
  department: z.string().optional(),
  assignee: z.string().optional(),
  photos: z.array(z.object({ name: z.string().max(200), dataUrl: z.string().max(2_500_000).optional() })).max(3).optional(),
});

app.post("/incidents", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "city_admin", "citizen");
  const b = CreateBody.parse(req.body);
  const isCitizen = onlyCitizen(c.roles);
  const dev = b.deviceId ? await deviceContext(c.tenantId, b.deviceId) : {};
  const department = b.department && !isCitizen ? b.department : await departmentFor(c.tenantId, b.category, dev.department);
  const created = await withTenant(c.tenantId, async (db) => {
    const row = await insertIncident(db, {
      tenantId: c.tenantId, title: b.title, description: b.description, category: b.category,
      severity: isCitizen ? "Medium" : b.severity, source: isCitizen ? "citizen" : "operator",
      zone: b.zone ?? dev.zone, lat: b.lat ?? dev.lat, lon: b.lon ?? dev.lon, deviceId: b.deviceId, reporter: c.userId,
      department, site: dev.site, asset: dev.asset, photos: b.photos,
      assignee: isCitizen ? undefined : b.assignee, status: !isCitizen && b.assignee ? "Assigned" : "New",
    });
    await addEvent(db, c.tenantId, row.id, "created", c.userName, { source: row.source, photos: b.photos?.length ?? 0 });
    return row;
  });
  await emit("incident.created", created, c.userId, { action: "create" });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "incident.created", resource: `incident/${created.id}` });
  return reply.code(201).send(created);
});

const TransitionBody = z.object({
  action: z.enum(ACTIONS as [Action, ...Action[]]),
  assignee: z.string().optional(),
  department: z.string().optional(),
  note: z.string().max(2000).optional(),
  closureCode: z.enum(CLOSURE_CODES).optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

app.post("/incidents/:id/transition", async (req: any) => {
  const c = ctx(req);
  const b = TransitionBody.parse(req.body);
  requireRole(c, ...(ACTION_ROLES[b.action as Action] as Persona[]));
  const citizen = onlyCitizen(c.roles);
  const updated = await withTenant(c.tenantId, async (db) => {
    const cur = await getIncident(db, req.params.id, true);
    if (!cur) throw new HttpError(404, "Incident not found");
    if (citizen && (cur.reporter !== c.userId || !CITIZEN_ACTIONS.includes(b.action))) throw new HttpError(404, "Incident not found");
    let to;
    try { to = nextStatus(cur.status, b.action); } catch (e) {
      if (e instanceof TransitionError) throw new HttpError(409, e.message);
      throw e;
    }
    if (b.action === "assign" && !b.assignee && !b.department) throw new HttpError(400, "assign needs assignee or department");
    if (b.action === "dismiss" && !b.closureCode) throw new HttpError(400, "dismiss needs a closureCode (duplicate, false_alarm, out_of_scope, resolved_elsewhere, test)");
    const sets = ["status=$2", "updated_at=now()"];
    const args: unknown[] = [cur.id, to];
    const set = (col: string, v: unknown) => { args.push(v); sets.push(`${col}=$${args.length}`); };
    if (b.action === "acknowledge" || (b.action === "assign" && cur.status === "New")) sets.push("acknowledged_at=coalesce(acknowledged_at, now())");
    if (b.action === "resolve" || b.action === "confirm") sets.push("resolved_at=now()");
    if (b.action === "close" || b.action === "dismiss") sets.push("closed_at=now()");
    if (b.action === "dismiss") { sets.push("resolved_at=coalesce(resolved_at, now())"); set("closure_code", b.closureCode); }
    if (b.action === "reopen") sets.push("resolved_at=null, closed_at=null");
    if (b.action === "escalate") sets.push("escalation_level=escalation_level+1");
    if (citizen && (b.rating || b.note)) set("citizen_feedback", JSON.stringify({ rating: b.rating, comment: b.note, at: new Date().toISOString(), action: b.action }));
    if (b.assignee) set("assignee", b.assignee);
    if (b.department) set("department", b.department);
    await db.query(`update incident.incidents set ${sets.join(", ")} where id=$1`, args);
    await addEvent(db, c.tenantId, cur.id, b.action === "escalate" ? "escalated" : "status.changed", c.userName,
      { from: cur.status, to, action: b.action, assignee: b.assignee, department: b.department, note: b.note, closureCode: b.closureCode, rating: b.rating });
    return (await getIncident(db, cur.id))!;
  });
  await emit("incident.updated", updated, c.userId, { action: b.action, note: b.note });
  await audit({ tenantId: c.tenantId, actor: c.userId, action: `incident.${b.action}`, resource: `incident/${updated.id}` });
  return { ...updated, allowedActions: allowedActions(updated.status, c.roles) };
});

app.post("/incidents/:id/comments", async (req: any) => {
  const c = ctx(req);
  requireRole(c, ...READ_ROLES);
  const { note } = z.object({ note: z.string().min(1).max(2000) }).parse(req.body);
  await withTenant(c.tenantId, (db) => addEvent(db, c.tenantId, req.params.id, "comment", c.userName, { note }));
  return { ok: true };
});

// ---------------------------------------------------------------- citizen advisories (published by the command centre)
const toAdvisory = (r: any) => ({
  id: r.id, title: r.title, body: r.body ?? undefined, category: r.category, level: r.level, zone: r.zone ?? undefined, lat: r.lat ?? undefined, lon: r.lon ?? undefined,
  incidentId: r.incident_id ?? undefined, startsAt: r.starts_at?.toISOString?.() ?? r.starts_at, endsAt: r.ends_at?.toISOString?.() ?? r.ends_at ?? undefined,
  publishedBy: r.published_by, active: !r.ends_at || new Date(r.ends_at).getTime() > Date.now(),
});

app.get("/advisories", async (req: any) => {
  const c = ctx(req);
  const all = req.query?.all === "true" && !onlyCitizen(c.roles);
  return withTenant(c.tenantId, async (db) => (await db.query(
    `select * from incident.advisories ${all ? "" : "where starts_at <= now() and (ends_at is null or ends_at > now())"} order by starts_at desc limit 100`)).rows.map(toAdvisory));
});

const AdvisoryBody = z.object({
  title: z.string().min(3).max(160), body: z.string().max(2000).optional(), category: z.string().default("general"),
  level: z.enum(["info", "warning", "critical"]).default("info"), zone: z.string().optional(), lat: z.number().optional(), lon: z.number().optional(),
  incidentId: z.string().uuid().optional(), hours: z.number().min(0.25).max(24 * 30).optional(),
});

app.post("/advisories", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "city_admin");
  const b = AdvisoryBody.parse(req.body);
  const row = await withTenant(c.tenantId, async (db) => (await db.query(
    `insert into incident.advisories (tenant_id, title, body, category, level, zone, lat, lon, incident_id, ends_at, published_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $10::float is null then null else now() + ($10::float * interval '1 hour') end, $11) returning *`,
    [c.tenantId, b.title, b.body ?? null, b.category, b.level, b.zone ?? null, b.lat ?? null, b.lon ?? null, b.incidentId ?? null, b.hours ?? null, c.userName])).rows[0]);
  const adv = toAdvisory(row);
  await publish(Topics.notifications, makeEvent({
    type: "advisory.published", tenantId: c.tenantId, source: "incident-service", entity: { type: "ADVISORY", id: adv.id, name: adv.title },
    data: { advisory: adv, subject: `[${adv.level.toUpperCase()}] ${adv.title}`, text: adv.body ?? adv.title, severity: adv.level === "critical" ? "Critical" : adv.level === "warning" ? "High" : "Medium" },
  }));
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "advisory.published", resource: `advisory/${adv.id}` });
  return reply.code(201).send(adv);
});

app.post("/advisories/:id/end", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "city_admin");
  await withTenant(c.tenantId, (db) => db.query("update incident.advisories set ends_at=now() where id=$1", [req.params.id]));
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "advisory.ended", resource: `advisory/${req.params.id}` });
  return { ended: true };
});

// ---------------------------------------------------------------- shift handover log
app.get("/shift-log", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "city_admin", "leadership");
  return withTenant(c.tenantId, async (db) => (await db.query("select id, author, shift, note, open_items, at from incident.shift_log order by at desc limit 50")).rows
    .map((r: any) => ({ id: r.id, author: r.author, shift: r.shift, note: r.note, openItems: r.open_items, at: r.at })));
});

app.post("/shift-log", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "operator", "dept_head", "city_admin");
  const b = z.object({ shift: z.string().min(1).max(40), note: z.string().min(3).max(4000), openItems: z.array(z.string().max(200)).max(50).default([]) }).parse(req.body);
  const row = await withTenant(c.tenantId, async (db) => (await db.query(
    "insert into incident.shift_log (tenant_id, author, shift, note, open_items) values ($1,$2,$3,$4,$5) returning id, at",
    [c.tenantId, c.userName, b.shift, b.note, JSON.stringify(b.openItems)])).rows[0]);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "shift.handover", resource: `shift/${row.id}` });
  return reply.code(201).send({ ...row, author: c.userName, ...b });
});

// ---------------------------------------------------------------- internal: platform usage
app.get("/internal/usage", async () => withTenant("*", async (db) => (await db.query(
  `select tenant_id, count(*) filter (where status in (${OPEN_SQL}))::int open,
     count(*) filter (where created_at >= now() - interval '24 hours')::int last24h,
     count(*) filter (where severity = 'Critical' and status in (${OPEN_SQL}))::int critical
   from incident.incidents group by tenant_id`)).rows));

// ---------------------------------------------------------------- start
await waitFor("postgres", () => getPool().query("select 1"));
await waitFor("kafka", () => runConsumer<AlarmData>({ groupId: "incident-service", topics: [Topics.alerts], handler: onAlarm }));
await listen(app);
logger.info("incident-service ready");
