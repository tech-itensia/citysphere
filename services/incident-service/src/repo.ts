import type pg from "pg";
import { getRedis, tkey } from "@scaas/common";
import type { Status } from "./lifecycle.ts";

export interface Incident {
  id: string;
  ref: string;
  tenantId: string;
  title: string;
  description?: string;
  category: string;
  severity: string;
  status: Status;
  source: string;
  deviceId?: string;
  deviceType?: string;
  alarmId?: string;
  alarmType?: string;
  zone?: string;
  lat?: number;
  lon?: number;
  department?: string;
  assignee?: string;
  reporter?: string;
  escalationLevel: number;
  sourceCleared: boolean;
  createdAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  closedAt?: string;
}

export const toIncident = (r: any): Incident => ({
  id: r.id, ref: `INC-${String(r.number).padStart(6, "0")}`, tenantId: r.tenant_id, title: r.title,
  description: r.description ?? undefined, category: r.category, severity: r.severity, status: r.status, source: r.source,
  deviceId: r.device_id ?? undefined, deviceType: r.device_type ?? undefined, alarmId: r.alarm_id ?? undefined,
  alarmType: r.alarm_type ?? undefined, zone: r.zone ?? undefined,
  lat: r.lat ?? undefined, lon: r.lon ?? undefined, department: r.department ?? undefined, assignee: r.assignee ?? undefined,
  reporter: r.reporter ?? undefined, escalationLevel: r.escalation_level, sourceCleared: r.source_cleared,
  createdAt: r.created_at?.toISOString?.() ?? r.created_at, updatedAt: r.updated_at?.toISOString?.() ?? r.updated_at,
  acknowledgedAt: r.acknowledged_at?.toISOString?.() ?? undefined, resolvedAt: r.resolved_at?.toISOString?.() ?? undefined,
  closedAt: r.closed_at?.toISOString?.() ?? undefined,
});

export async function insertIncident(c: pg.PoolClient, i: Omit<Incident, "id" | "ref" | "createdAt" | "updatedAt" | "escalationLevel" | "sourceCleared" | "status"> & { status?: Status }): Promise<Incident> {
  const r = await c.query(
    `insert into incident.incidents
      (tenant_id, title, description, category, severity, status, source, device_id, device_type, alarm_id, alarm_type, zone, lat, lon, department, assignee, reporter)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
    [i.tenantId, i.title, i.description ?? null, i.category, i.severity, i.status ?? "New", i.source, i.deviceId ?? null,
      i.deviceType ?? null, i.alarmId ?? null, i.alarmType ?? null, i.zone ?? null, i.lat ?? null, i.lon ?? null,
      i.department ?? null, i.assignee ?? null, i.reporter ?? null]);
  return toIncident(r.rows[0]);
}

export async function addEvent(c: pg.PoolClient, tenantId: string, incidentId: string, type: string, actor: string, data: Record<string, unknown> = {}) {
  await c.query(
    "insert into incident.incident_events (tenant_id, incident_id, type, actor, data) values ($1,$2,$3,$4,$5)",
    [tenantId, incidentId, type, actor, JSON.stringify(data)]);
}

export async function getIncident(c: pg.PoolClient, id: string, lock = false): Promise<Incident | undefined> {
  const r = await c.query(`select * from incident.incidents where id=$1${lock ? " for update" : ""}`, [id]);
  return r.rows[0] ? toIncident(r.rows[0]) : undefined;
}

/** Location + zone of a device from the twin cache maintained by tb-bridge. */
export async function deviceLocation(tenantId: string, deviceId: string): Promise<{ lat?: number; lon?: number; zone?: string }> {
  const v = await getRedis().hget(tkey(tenantId, "twin"), deviceId);
  if (!v) return {};
  const d = JSON.parse(v);
  return { lat: d.lat, lon: d.lon, zone: d.zone };
}
