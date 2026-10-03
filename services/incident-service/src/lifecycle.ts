/** Incident lifecycle (SOW 4.3 / 4.5). Pure and dependency-free. */
export const STATUSES = ["New", "Acknowledged", "Assigned", "In Progress", "Resolved", "Verified", "Closed", "Reopened"] as const;
export type Status = (typeof STATUSES)[number];
export type Action = "acknowledge" | "assign" | "start" | "resolve" | "verify" | "close" | "reopen" | "escalate";
export type Severity = "Critical" | "High" | "Medium" | "Low";

const OPEN: Status[] = ["New", "Acknowledged", "Assigned", "In Progress", "Reopened"];
export const isOpen = (s: Status) => OPEN.includes(s);

/** action -> allowed from-states and resulting state (undefined = status unchanged). */
const RULES: Record<Action, { from: Status[]; to?: Status }> = {
  acknowledge: { from: ["New", "Reopened"], to: "Acknowledged" },
  assign: { from: ["New", "Acknowledged", "Assigned", "In Progress", "Reopened"], to: "Assigned" },
  start: { from: ["Assigned"], to: "In Progress" },
  resolve: { from: ["Acknowledged", "Assigned", "In Progress", "Reopened", "New"], to: "Resolved" },
  verify: { from: ["Resolved"], to: "Verified" },
  close: { from: ["Resolved", "Verified"], to: "Closed" },
  reopen: { from: ["Resolved", "Verified"], to: "Reopened" },
  escalate: { from: OPEN },
};

export const ACTION_ROLES: Record<Action, string[]> = {
  acknowledge: ["operator", "dept_head", "city_admin"],
  assign: ["operator", "dept_head", "city_admin"],
  start: ["operator", "dept_head", "field_tech"],
  resolve: ["operator", "dept_head", "field_tech", "city_admin"],
  verify: ["operator", "dept_head", "city_admin"],
  close: ["dept_head", "city_admin", "operator"],
  reopen: ["operator", "dept_head", "city_admin"],
  escalate: ["operator", "dept_head", "city_admin"],
};

export class TransitionError extends Error {}

export function nextStatus(current: Status, action: Action): Status {
  const rule = RULES[action];
  if (!rule) throw new TransitionError(`Unknown action ${action}`);
  if (!rule.from.includes(current)) throw new TransitionError(`Cannot ${action} an incident that is ${current}`);
  if (action === "assign" && current === "In Progress") return "In Progress"; // re-assignment keeps work going
  return rule.to ?? current;
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

/** Department that owns each category by default. */
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
