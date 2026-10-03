/** SLA maths (SOW 4.5). Both clocks start at incident creation. Pure and dependency-free. */
export type Rag = "green" | "amber" | "red" | "met" | "met_late";
export type Severity = "Critical" | "High" | "Medium" | "Low";

export interface Policy {
  responseMin: number;
  resolutionMin: number;
  amberPct: number; // share of the window after which the timer turns amber
  escalateTo: string;
  autoEscalate: boolean;
}

export const DEFAULT_POLICIES: Record<Severity, Policy> = {
  Critical: { responseMin: 5, resolutionMin: 240, amberPct: 75, escalateTo: "dept_head,city_admin", autoEscalate: true },
  High: { responseMin: 15, resolutionMin: 480, amberPct: 75, escalateTo: "dept_head", autoEscalate: true },
  Medium: { responseMin: 60, resolutionMin: 1440, amberPct: 80, escalateTo: "operator", autoEscalate: false },
  Low: { responseMin: 240, resolutionMin: 4320, amberPct: 80, escalateTo: "", autoEscalate: false },
};

export interface Deadlines {
  responseDue: number;
  resolutionDue: number;
  responseAmber: number;
  resolutionAmber: number;
}

export function deadlines(createdAt: number, p: Policy): Deadlines {
  const m = 60_000;
  return {
    responseDue: createdAt + p.responseMin * m,
    resolutionDue: createdAt + p.resolutionMin * m,
    responseAmber: createdAt + Math.round(p.responseMin * m * p.amberPct / 100),
    resolutionAmber: createdAt + Math.round(p.resolutionMin * m * p.amberPct / 100),
  };
}

export function rag(now: number, amberAt: number, dueAt: number, metAt?: number | null): Rag {
  if (metAt) return metAt <= dueAt ? "met" : "met_late";
  if (now >= dueAt) return "red";
  if (now >= amberAt) return "amber";
  return "green";
}

/** Redis sorted-set checkpoints for one incident. */
export function checkpoints(tenantId: string, incidentId: string, d: Deadlines): Array<[number, string]> {
  return [
    [d.responseAmber, `${tenantId}|${incidentId}|response|amber`],
    [d.responseDue, `${tenantId}|${incidentId}|response|red`],
    [d.resolutionAmber, `${tenantId}|${incidentId}|resolution|amber`],
    [d.resolutionDue, `${tenantId}|${incidentId}|resolution|red`],
  ];
}

export function parseCheckpoint(member: string) {
  const [tenantId, incidentId, clock, level] = member.split("|");
  return { tenantId, incidentId, clock: clock as "response" | "resolution", level: level as "amber" | "red" };
}

/** Work order lifecycle. */
export const WO_RULES: Record<string, { from: string[]; to: string }> = {
  assign: { from: ["Open", "Assigned", "Accepted", "On Hold"], to: "Assigned" },
  accept: { from: ["Assigned"], to: "Accepted" },
  start: { from: ["Assigned", "Accepted"], to: "In Progress" },
  hold: { from: ["In Progress"], to: "On Hold" },
  resume: { from: ["On Hold"], to: "In Progress" },
  complete: { from: ["In Progress"], to: "Completed" },
  verify: { from: ["Completed"], to: "Verified" },
  reject: { from: ["Completed"], to: "In Progress" },
  close: { from: ["Verified", "Completed"], to: "Closed" },
  cancel: { from: ["Open", "Assigned", "Accepted", "In Progress", "On Hold"], to: "Cancelled" },
};

export const WO_ROLES: Record<string, string[]> = {
  assign: ["operator", "dept_head", "city_admin"],
  accept: ["field_tech"],
  start: ["field_tech", "dept_head"],
  hold: ["field_tech", "dept_head"],
  resume: ["field_tech", "dept_head"],
  complete: ["field_tech", "dept_head"],
  verify: ["dept_head", "operator", "city_admin"],
  reject: ["dept_head", "operator", "city_admin"],
  close: ["dept_head", "city_admin"],
  cancel: ["operator", "dept_head", "city_admin"],
};

export function woNext(current: string, action: string): string {
  const r = WO_RULES[action];
  if (!r) throw new Error(`Unknown work order action ${action}`);
  if (!r.from.includes(current)) throw new Error(`Cannot ${action} a work order that is ${current}`);
  return r.to;
}
