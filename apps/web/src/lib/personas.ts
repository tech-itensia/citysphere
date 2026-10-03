export type Persona =
  | "super_admin" | "city_admin" | "leadership" | "operator" | "dept_head"
  | "field_tech" | "analyst" | "it_ops" | "citizen";

export interface NavItem { to: string; label: string; icon: string }

export const PERSONA_META: Record<Persona, { label: string; description: string; color: string; icon: string; home: string }> = {
  super_admin: { label: "Platform Super Admin", description: "All cities, onboarding, platform health", color: "#0f172a", icon: "Globe", home: "/platform" },
  city_admin: { label: "City Admin", description: "Users, SLA policies, API keys, integrations", color: "#4f46e5", icon: "Settings", home: "/admin" },
  leadership: { label: "Leadership / Mayor", description: "City Operating System overview", color: "#2563eb", icon: "Building2", home: "/overview" },
  operator: { label: "Command Centre Operator", description: "Live map, incident queue, SLA timers", color: "#ef4444", icon: "Siren", home: "/command-centre" },
  dept_head: { label: "Department Head", description: "Department incidents, SLA, crews", color: "#f97316", icon: "Users", home: "/department" },
  field_tech: { label: "Field Technician", description: "My work orders on site", color: "#22c55e", icon: "Wrench", home: "/field" },
  analyst: { label: "Analyst", description: "Trends, SLA compliance, reports", color: "#8b5cf6", icon: "BarChart3", home: "/analytics" },
  it_ops: { label: "IT / Platform Ops", description: "Service health, ingestion, audit", color: "#06b6d4", icon: "Server", home: "/ops" },
  citizen: { label: "Citizen", description: "Report an issue and track it", color: "#14b8a6", icon: "Megaphone", home: "/citizen" },
};

const ALL: Record<string, NavItem> = {
  platform: { to: "/platform", label: "Tenants", icon: "Globe" },
  overview: { to: "/overview", label: "City overview", icon: "Home" },
  command: { to: "/command-centre", label: "Command Centre", icon: "Siren" },
  incidents: { to: "/incidents", label: "Incidents", icon: "AlertTriangle" },
  workorders: { to: "/work-orders", label: "Work orders", icon: "ClipboardList" },
  twin: { to: "/twin", label: "Digital twin", icon: "Layers" },
  analytics: { to: "/analytics", label: "Analytics", icon: "BarChart3" },
  department: { to: "/department", label: "My department", icon: "Users" },
  field: { to: "/field", label: "My jobs", icon: "Wrench" },
  ops: { to: "/ops", label: "System health", icon: "Server" },
  admin: { to: "/admin", label: "Administration", icon: "Settings" },
  citizen: { to: "/citizen", label: "Report an issue", icon: "Megaphone" },
};

const NAV: Record<Persona, string[]> = {
  super_admin: ["platform", "overview", "command", "incidents", "workorders", "twin", "analytics", "ops", "admin"],
  city_admin: ["admin", "overview", "incidents", "workorders", "twin", "analytics", "ops"],
  leadership: ["overview", "analytics", "twin", "incidents"],
  operator: ["command", "incidents", "workorders", "twin", "overview"],
  dept_head: ["department", "incidents", "workorders", "analytics", "twin"],
  field_tech: ["field"],
  analyst: ["analytics", "overview", "incidents", "twin"],
  it_ops: ["ops", "twin", "incidents"],
  citizen: ["citizen"],
};

/** Union of navigation for every role the user holds, in priority order. */
export function navFor(roles: Persona[]): NavItem[] {
  const keys: string[] = [];
  for (const r of roles) for (const k of NAV[r] ?? []) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => ALL[k]);
}

export function primaryPersona(roles: Persona[]): Persona {
  const order: Persona[] = ["super_admin", "city_admin", "leadership", "operator", "dept_head", "field_tech", "analyst", "it_ops", "citizen"];
  return order.find((p) => roles.includes(p)) ?? "citizen";
}

export function canAccess(roles: Persona[], path: string): boolean {
  if (path === "/" || path === "/login") return true;
  return navFor(roles).some((n) => path.startsWith(n.to));
}

/** Demo users (match infra/keycloak/realm-scaas.json; password Demo@123). */
export const DEMO_USERS: Array<{ username: string; tenant: string; persona: Persona; name: string }> = [
  { username: "superadmin", tenant: "delhi", persona: "super_admin", name: "Platform Admin" },
  { username: "admin.delhi", tenant: "delhi", persona: "city_admin", name: "Delhi Admin" },
  { username: "mayor.delhi", tenant: "delhi", persona: "leadership", name: "Delhi Commissioner" },
  { username: "operator.delhi", tenant: "delhi", persona: "operator", name: "Delhi Operator" },
  { username: "waterhead.delhi", tenant: "delhi", persona: "dept_head", name: "Water Dept Head" },
  { username: "tech.delhi", tenant: "delhi", persona: "field_tech", name: "Field Technician" },
  { username: "analyst.delhi", tenant: "delhi", persona: "analyst", name: "City Analyst" },
  { username: "itops.delhi", tenant: "delhi", persona: "it_ops", name: "IT Ops" },
  { username: "citizen.delhi", tenant: "delhi", persona: "citizen", name: "Delhi Resident" },
];
