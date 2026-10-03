import { z } from "zod";
import {
  createApp, listen, ctx, requireRole, withTenant, runConsumer, Topics, logger, waitFor, getPool, audit,
  type EventEnvelope,
} from "@scaas/common";
import { sendEmail, sendWebhook, sendSms, sendPush, type Message } from "./channels.ts";

const app = createApp({ internalOnly: true });
const RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

interface Channel { id: string; channel: "email" | "sms" | "webhook" | "push"; target: string; secret: string | null; events: string[]; min_severity: string; department: string | null }

/** Which notification "kind" an event is, its severity, department and the message text. */
function describe(e: EventEnvelope<any>): { kind: string; severity: string; department?: string; message: Message; to?: string } | undefined {
  const d = e.data ?? {};
  if (e.type.startsWith("incident.")) {
    const i = d.incident;
    if (!i) return undefined;
    if (e.type === "incident.created") return { kind: "incident.created", severity: i.severity, department: i.department,
      message: { subject: `[${i.severity}] ${i.ref} ${i.title}`, text: `New ${i.category} incident in ${i.zone ?? "unknown zone"}.\n${i.description ?? ""}`, payload: { event: e.type, incident: i } } };
    if (d.action === "escalate") return { kind: "incident.escalated", severity: i.severity, department: i.department,
      message: { subject: `[ESCALATED L${i.escalationLevel}] ${i.ref} ${i.title}`, text: d.note ?? "Incident escalated", payload: { event: "incident.escalated", incident: i } } };
    return undefined;
  }
  if (e.type === "sla.breached" || e.type === "sla.amber") return { kind: e.type, severity: d.severity, message: {
    subject: `${e.type === "sla.breached" ? "SLA BREACHED" : "SLA near breach"}: ${d.clock} for incident ${d.incidentId}`,
    text: `${d.severity} ${d.category} incident. ${d.clock} due ${d.dueAt}. Escalate to: ${d.escalateTo || "n/a"}`, payload: { event: e.type, ...d } } };
  if (e.type.startsWith("workorder.")) {
    const w = d.workOrder;
    if (!w) return undefined;
    if (e.type === "workorder.created" || d.action === "assign") return { kind: "workorder.assigned", severity: w.priority, department: w.department, to: w.assignee,
      message: { subject: `Work order ${w.ref} assigned: ${w.title}`, text: `Priority ${w.priority}. Due ${w.dueAt ?? "n/a"}.`, payload: { event: "workorder.assigned", workOrder: w } } };
    return undefined;
  }
  if (e.type === "notification.requested") return { kind: "manual", severity: d.severity ?? "Medium", message: { subject: d.subject, text: d.text, payload: d } };
  return undefined;
}

async function deliver(tenantId: string, ch: Channel, target: string, m: Message, kind: string) {
  let status = "sent", error: string | null = null;
  try {
    if (ch.channel === "email") await sendEmail(target, m);
    else if (ch.channel === "webhook") await sendWebhook(target, ch.secret, m);
    else if (ch.channel === "sms") await sendSms(target, m);
    else await sendPush(target, m);
  } catch (err) {
    status = "failed";
    error = (err as Error).message;
    logger.warn({ err, channel: ch.channel, target }, "notification delivery failed");
  }
  await withTenant(tenantId, (c) => c.query(
    "insert into notify.notifications (tenant_id, channel, recipient, kind, subject, body, status, error) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [tenantId, ch.channel, target, kind, m.subject, m.text, status, error]));
}

async function onEvent(e: EventEnvelope<any>) {
  const info = describe(e);
  if (!info) return;
  const channels: Channel[] = await withTenant(e.tenantId, async (c) => (await c.query("select * from notify.channels where enabled")).rows);
  for (const ch of channels) {
    if (!ch.events.includes(info.kind) && !ch.events.includes("*")) continue;
    if ((RANK[info.severity] ?? 2) < (RANK[ch.min_severity] ?? 1)) continue;
    if (ch.department && info.department && ch.department !== info.department) continue;
    await deliver(e.tenantId, ch, ch.target === "$assignee" ? (info.to ?? "") : ch.target, info.message, info.kind);
  }
}

app.get("/notifications", async (req: any) => {
  const c = ctx(req);
  return withTenant(c.tenantId, async (db) => (await db.query("select id, channel, recipient, kind, subject, status, at from notify.notifications order by at desc limit 50")).rows);
});

app.get("/notifications/channels", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin", "it_ops");
  return withTenant(c.tenantId, async (db) => (await db.query("select id, channel, target, events, min_severity, department, enabled from notify.channels order by channel")).rows);
});

const ChannelBody = z.object({
  channel: z.enum(["email", "sms", "webhook", "push"]), target: z.string().min(3), secret: z.string().optional(),
  events: z.array(z.string()).min(1), minSeverity: z.enum(["Critical", "High", "Medium", "Low"]).default("High"),
  department: z.string().optional(), enabled: z.boolean().default(true),
});

app.post("/notifications/channels", async (req: any, reply: any) => {
  const c = ctx(req);
  requireRole(c, "city_admin");
  const b = ChannelBody.parse(req.body);
  const row = await withTenant(c.tenantId, async (db) => (await db.query(
    "insert into notify.channels (tenant_id, channel, target, secret, events, min_severity, department, enabled) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
    [c.tenantId, b.channel, b.target, b.secret ?? null, b.events, b.minSeverity, b.department ?? null, b.enabled])).rows[0]);
  await audit({ tenantId: c.tenantId, actor: c.userId, action: "notification.channel.created", resource: `channel/${row.id}` });
  return reply.code(201).send(row);
});

await waitFor("postgres", () => getPool().query("select 1"));
await waitFor("kafka", () => runConsumer({
  groupId: "notification-service",
  topics: [Topics.incidents, Topics.sla, Topics.workOrders, Topics.notifications],
  handler: onEvent,
}));
await listen(app);
logger.info("notification-service ready");
