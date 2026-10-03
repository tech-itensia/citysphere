export type Persona =
  | "super_admin" | "city_admin" | "leadership" | "operator" | "dept_head"
  | "field_tech" | "analyst" | "it_ops" | "citizen";

export interface NavItem { to: string; label: string; icon: string; module?: string }

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
  platform: { to: "/platform", label: "Platform console", icon: "Globe" },
  overview: { to: "/overview", label: "City overview", icon: "Home" },
  command: { to: "/command-centre", label: "Command Centre", icon: "Siren", module: "command_centre" },
  incidents: { to: "/incidents", label: "Incidents", icon: "AlertTriangle" },
  workorders: { to: "/work-orders", label: "Work orders", icon: "ClipboardList", module: "sla_workorders" },
  assets: { to: "/assets", label: "Assets & devices", icon: "Cpu", module: "digital_twin" },
  twin: { to: "/twin", label: "Digital twin", icon: "Layers", module: "digital_twin" },
  analytics: { to: "/analytics", label: "Analytics & reports", icon: "BarChart3", module: "analytics" },
  department: { to: "/department", label: "My department", icon: "Users" },
  field: { to: "/field", label: "My jobs", icon: "Wrench" },
  ops: { to: "/ops", label: "System health", icon: "Server" },
  admin: { to: "/admin", label: "City setup", icon: "Settings" },
  citizen: { to: "/citizen", label: "Citizen portal", icon: "Megaphone", module: "citizen_portal" },
};

const NAV: Record<Persona, string[]> = {
  super_admin: ["platform", "overview", "command", "incidents", "workorders", "assets", "twin", "analytics", "ops", "admin"],
  city_admin: ["admin", "overview", "assets", "incidents", "workorders", "twin", "analytics", "ops"],
  leadership: ["overview", "analytics", "twin", "incidents"],
  operator: ["command", "incidents", "workorders", "twin", "assets", "overview"],
  dept_head: ["department", "incidents", "workorders", "assets", "analytics", "twin"],
  field_tech: ["field"],
  analyst: ["analytics", "overview", "incidents", "twin"],
  it_ops: ["ops", "assets", "twin", "incidents"],
  citizen: ["citizen"],
};

/** Union of navigation for every role the user holds, in priority order; hides modules the city's plan does not include. */
export function navFor(roles: Persona[], modules?: string[]): NavItem[] {
  const keys: string[] = [];
  for (const r of roles) for (const k of NAV[r] ?? []) if (!keys.includes(k)) keys.push(k);
  return keys.map((k) => ALL[k]).filter((n) => roles.includes("super_admin") || !n.module || !modules || modules.includes(n.module));
}

export function primaryPersona(roles: Persona[]): Persona {
  const order: Persona[] = ["super_admin", "city_admin", "leadership", "operator", "dept_head", "field_tech", "analyst", "it_ops", "citizen"];
  return order.find((p) => roles.includes(p)) ?? "citizen";
}

export function canAccess(roles: Persona[], path: string, modules?: string[]): boolean {
  if (path === "/" || path === "/login") return true;
  return navFor(roles, modules).some((n) => path.startsWith(n.to));
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
