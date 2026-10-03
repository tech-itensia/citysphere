/** Pure functions for twin health, shared by the summary API and tests. */
export type DomainStatus = "Operational" | "Moderate" | "Attention" | "Critical";

export interface TwinDevice {
  deviceId: string;
  deviceType: string;
  domain: string;
  zone?: string;
  lat?: number;
  lon?: number;
  ts: number;
  values: Record<string, unknown>;
}

export interface AlarmState { deviceId: string; alarmType: string; severity: string }

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, MAJOR: 3, MINOR: 2, WARNING: 1, INDETERMINATE: 1 };

export function statusFor(healthPct: number): DomainStatus {
  if (healthPct >= 95) return "Operational";
  if (healthPct >= 85) return "Moderate";
  if (healthPct >= 70) return "Attention";
  return "Critical";
}

export function worstSeverity(alarms: AlarmState[]): string | undefined {
  return alarms.reduce<string | undefined>((w, a) => (!w || (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[w] ?? 0) ? a.severity : w), undefined);
}

/**
 * Health of a domain = share of its devices that are online (reported within staleMs) and have no
 * MAJOR/CRITICAL alarm. Overall score = device-weighted mean across domains.
 */
export function summarize(devices: TwinDevice[], alarms: AlarmState[], now = Date.now(), staleMs = 15 * 60_000) {
  const byDevice = new Map<string, AlarmState[]>();
  for (const a of alarms) byDevice.set(a.deviceId, [...(byDevice.get(a.deviceId) ?? []), a]);

  const domains = new Map<string, { total: number; healthy: number; offline: number; alarmed: number }>();
  for (const d of devices) {
    const s = domains.get(d.domain) ?? { total: 0, healthy: 0, offline: 0, alarmed: 0 };
    s.total++;
    const offline = now - d.ts > staleMs;
    const sev = worstSeverity(byDevice.get(d.deviceId) ?? []);
    const serious = sev !== undefined && (SEVERITY_RANK[sev] ?? 0) >= 3;
    if (offline) s.offline++;
    if (sev) s.alarmed++;
    if (!offline && !serious) s.healthy++;
    domains.set(d.domain, s);
  }
  const list = [...domains.entries()].map(([domain, s]) => {
    const healthPct = s.total ? Math.round((s.healthy / s.total) * 1000) / 10 : 100;
    return { domain, ...s, healthPct, status: statusFor(healthPct) };
  }).sort((a, b) => a.domain.localeCompare(b.domain));

  const total = list.reduce((n, d) => n + d.total, 0);
  const healthy = list.reduce((n, d) => n + d.healthy, 0);
  const overall = total ? Math.round((healthy / total) * 1000) / 10 : 100;
  const statusCounts = { Operational: 0, Moderate: 0, Attention: 0, Critical: 0 } as Record<DomainStatus, number>;
  for (const d of list) statusCounts[d.status]++;
  return { overallScore: overall, devices: total, activeAlarms: alarms.length, statusCounts, domains: list };
}
