/**
 * Incident lifecycle v2 (micro project plan, section F "Incident Lifecycle State Machine (Updated)").
 * New -> Acknowledged -> Assigned -> In Progress -> Resolution Pending -> Resolved -> Closed,
 * with Escalated (returns to In Progress), Reopen (back to In Progress) and Dismiss (duplicate / false alarm).
 * Both SLA clocks start at creation; acknowledgement stops the response clock; closure (or resolution) stops the resolution clock.
 * Pure and dependency-free.
 */
export const STATUSES = ["New", "Acknowledged", "Assigned", "In Progress", "Escalated", "Resolution Pending", "Resolved", "Closed"] as const;
export type Status = (typeof STATUSES)[number];
export type Action = "acknowledge" | "assign" | "start" | "escalate" | "complete" | "resolve" | "confirm" | "reopen" | "close" | "dismiss";
export const ACTIONS: Action[] = ["acknowledge", "assign", "start", "escalate", "complete", "resolve", "confirm", "reopen", "close", "dismiss"];
export type Severity = "Critical" | "High" | "Medium" | "Low";

export const OPEN_STATUSES: Status[] = ["New", "Acknowledged", "Assigned", "In Progress", "Escalated", "Resolution Pending"];
export const isOpen = (s: Status | string) => (OPEN_STATUSES as string[]).includes(s);
/** SQL list for "open" filters, e.g. `status in (${OPEN_SQL})`. */
export const OPEN_SQL = OPEN_STATUSES.map((s) => `'${s}'`).join(",");

export const CLOSURE_CODES = ["duplicate", "false_alarm", "out_of_scope", "resolved_elsewhere", "test"] as const;

/** action -> allowed from-states and resulting state (undefined = status unchanged). */
const RULES: Record<Action, { from: Status[]; to?: Status }> = {
  acknowledge: { from: ["New"], to: "Acknowledged" },
  assign: { from: ["New", "Acknowledged", "Assigned", "In Progress", "Escalated"], to: "Assigned" },
  start: { from: ["Acknowledged", "Assigned", "Escalated"], to: "In Progress" },
  escalate: { from: ["New", "Acknowledged", "Assigned", "In Progress", "Escalated"] },
  complete: { from: ["Assigned", "In Progress", "Escalated"], to: "Resolution Pending" },
  resolve: { from: ["Acknowledged", "Assigned", "In Progress", "Escalated", "Resolution Pending"], to: "Resolved" },
  confirm: { from: ["Resolution Pending"], to: "Resolved" },
  reopen: { from: ["Resolution Pending", "Resolved"], to: "In Progress" },
  close: { from: ["Resolved"], to: "Closed" },
  dismiss: { from: ["New", "Acknowledged"], to: "Closed" },
};

export const ACTION_ROLES: Record<Action, string[]> = {
  acknowledge: ["operator", "dept_head", "city_admin"],
  assign: ["operator", "dept_head", "city_admin"],
  start: ["operator", "dept_head", "field_tech"],
  escalate: ["operator", "dept_head", "city_admin"],
  complete: ["field_tech", "dept_head", "operator", "city_admin"],
  resolve: ["operator", "dept_head", "city_admin"],
  confirm: ["operator", "dept_head", "city_admin", "citizen"],
  reopen: ["operator", "dept_head", "city_admin", "citizen"],
  close: ["operator", "dept_head", "city_admin"],
  dismiss: ["operator", "dept_head", "city_admin"],
};

/** Actions a citizen may take, and only on incidents they reported. */
export const CITIZEN_ACTIONS: Action[] = ["confirm", "reopen"];

export class TransitionError extends Error {}

export function nextStatus(current: Status, action: Action): Status {
  const rule = RULES[action];
  if (!rule) throw new TransitionError(`Unknown action ${action}`);
  if (!rule.from.includes(current)) throw new TransitionError(`Cannot ${action} an incident that is ${current}`);
  if (action === "assign" && current === "In Progress") return "In Progress"; // re-assignment keeps work going
  if (action === "escalate") return current === "Assigned" || current === "In Progress" ? "Escalated" : current; // before pickup: flag only
  return rule.to ?? current;
}

/** Actions allowed from a status for a set of roles (drives the UI buttons). */
export function allowedActions(current: Status, roles: string[]): Action[] {
  return ACTIONS.filter((a) => RULES[a].from.includes(current) && (roles.includes("super_admin") || ACTION_ROLES[a].some((r) => roles.includes(r))));
}

/** ThingsBoard alarm severity -> platform severity. */
export function mapSeverity(tb: string): Severity {
  switch (tb) {
    case "CRITICAL": return "Critical";
    case "MAJOR": return "High";
    case "MINOR": return "Medium";
    default: return "Low";
  }
}

export const SEVERITY_RANK: Record<Severity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

/** Department that owns each category by default (a city's own routing rules and the device registry override it). */
export const CATEGORY_DEPARTMENT: Record<string, string> = {
  lighting: "Street Lighting",
  traffic: "Traffic Police",
  environment: "Environment",
  water: "Water Supply",
  electricity: "Electricity",
  waste: "Solid Waste",
  parking: "Traffic Police",
  mobility: "Transport",
  weather: "Disaster Management",
  events: "Disaster Management",
  emergency: "Emergency Services",
  generic: "Operations",
};

/** Same device + same category, still open, within 15 minutes = duplicate (merged). */
export function isDuplicate(existing: { deviceId?: string | null; category: string; status: Status; createdAt: number }, incoming: { deviceId: string; category: string; at: number }, windowMs = 15 * 60_000): boolean {
  return existing.deviceId === incoming.deviceId
    && existing.category === incoming.category
    && isOpen(existing.status)
    && incoming.at - existing.createdAt <= windowMs;
}
