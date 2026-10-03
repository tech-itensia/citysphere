/**
 * Correlation rules (SOW 4.2d, M4). Pure: the service feeds signals in, rules return correlated alerts.
 * Each rule looks at a sliding window of recent signals for one tenant.
 */
export interface Signal {
  kind: "alarm" | "observation";
  at: number;
  deviceId: string;
  deviceType?: string;
  zone?: string;
  alarmType?: string;
  severity?: string;
  values?: Record<string, unknown>;
}

export interface Correlated {
  ruleId: string;
  alarmType: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR" | "WARNING";
  deviceId: string; // virtual originator for the incident
  deviceType: string;
  zone?: string;
  evidence: string[];
}

export interface Rule { id: string; windowMs: number; evaluate: (signals: Signal[], now: number) => Correlated[] }

const recent = (s: Signal[], now: number, ms: number) => s.filter((x) => now - x.at <= ms);
const activeAlarms = (s: Signal[], type: string) => s.filter((x) => x.kind === "alarm" && x.alarmType === type && x.severity !== "CLEARED");

export const RULES: Rule[] = [
  {
    id: "rain-congestion",
    windowMs: 30 * 60_000,
    evaluate(signals, now) {
      const w = recent(signals, now, this.windowMs);
      const rain = w.filter((x) => x.deviceType === "Weather Feed" && Number(x.values?.rainMm ?? 0) >= 10);
      const jams = activeAlarms(w, "Congestion");
      if (!rain.length || jams.length < 2) return [];
      return [{
        ruleId: this.id, alarmType: "Rain-Induced Congestion", severity: "MAJOR", deviceId: "CORR-RAIN-TRAFFIC", deviceType: "Traffic Junction",
        evidence: [`rain ${rain.at(-1)!.values?.rainMm} mm`, ...jams.map((j) => `Congestion at ${j.deviceId}${j.zone ? ` (${j.zone})` : ""}`)],
      }];
    },
  },
  {
    id: "event-traffic",
    windowMs: 60 * 60_000,
    evaluate(signals, now) {
      const w = recent(signals, now, this.windowMs);
      const events = w.filter((x) => x.deviceType === "City Event Feed" && x.values?.active === true && Number(x.values?.expectedCrowd ?? 0) >= 5000);
      const out: Correlated[] = [];
      for (const ev of events) {
        const jams = activeAlarms(w, "Congestion").filter((j) => !ev.zone || j.zone === ev.zone);
        if (jams.length) out.push({
          ruleId: this.id, alarmType: "Event Traffic Impact", severity: "MAJOR", deviceId: `CORR-EVENT-${ev.deviceId}`, deviceType: "Traffic Junction", zone: ev.zone,
          evidence: [`${ev.deviceId}: crowd ${ev.values?.expectedCrowd}`, ...jams.map((j) => `Congestion at ${j.deviceId}`)],
        });
      }
      return out;
    },
  },
  {
    id: "water-main-break",
    windowMs: 15 * 60_000,
    evaluate(signals, now) {
      const w = recent(signals, now, this.windowMs);
      const byZone = new Map<string, Signal[]>();
      for (const a of activeAlarms(w, "Low Water Pressure")) byZone.set(a.zone ?? "?", [...(byZone.get(a.zone ?? "?") ?? []), a]);
      return [...byZone.entries()]
        .filter(([, list]) => new Set(list.map((x) => x.deviceId)).size >= 3)
        .map(([zone, list]) => ({
          ruleId: this.id, alarmType: "Possible Water Main Break", severity: "CRITICAL" as const, deviceId: `CORR-WATER-${zone.replace(/\W+/g, "-")}`,
          deviceType: "Water Node", zone: zone === "?" ? undefined : zone, evidence: [...new Set(list.map((x) => x.deviceId))].map((d) => `Low pressure at ${d}`),
        }));
    },
  },
];

/** Keeps a bounded per-tenant window and returns newly fired correlations (each fires once per cool-down). */
export class Correlator {
  private signals = new Map<string, Signal[]>();
  private fired = new Map<string, number>();
  private readonly maxWindow = Math.max(...RULES.map((r) => r.windowMs));
  private readonly coolDownMs: number;

  constructor(coolDownMs = 60 * 60_000) {
    this.coolDownMs = coolDownMs;
  }

  add(tenantId: string, s: Signal, now = Date.now()): Correlated[] {
    let list = this.signals.get(tenantId) ?? [];
    if (s.kind === "alarm" && s.severity === "CLEARED") {
      list = list.filter((x) => !(x.kind === "alarm" && x.deviceId === s.deviceId && x.alarmType === s.alarmType));
    } else {
      list.push(s);
    }
    list = list.filter((x) => now - x.at <= this.maxWindow).slice(-5000);
    this.signals.set(tenantId, list);

    const out: Correlated[] = [];
    for (const rule of RULES) {
      for (const c of rule.evaluate(list, now)) {
        const key = `${tenantId}|${c.ruleId}|${c.deviceId}`;
        const last = this.fired.get(key);
        if (last !== undefined && now - last < this.coolDownMs) continue;
        this.fired.set(key, now);
        out.push(c);
      }
    }
    return out;
  }
}
