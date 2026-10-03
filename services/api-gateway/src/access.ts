/** Coarse persona -> route access at the edge. Services re-check fine-grained rules. Pure. */
export type Persona = "super_admin" | "city_admin" | "leadership" | "operator" | "dept_head" | "field_tech" | "analyst" | "it_ops" | "citizen";
export const PERSONAS: Persona[] = ["super_admin", "city_admin", "leadership", "operator", "dept_head", "field_tech", "analyst", "it_ops", "citizen"];

const STAFF: Persona[] = ["city_admin", "leadership", "operator", "dept_head", "field_tech", "analyst", "it_ops"];

export const ROUTES: Array<{ prefix: string; upstream: string; path: string; roles: Persona[] }> = [
  { prefix: "/api/tenants", upstream: "TENANT", path: "/tenants", roles: [...STAFF, "citizen"] },
  { prefix: "/api/incidents", upstream: "INCIDENT", path: "/incidents", roles: [...STAFF, "citizen"] },
  { prefix: "/api/sla", upstream: "SLA", path: "/sla", roles: ["operator", "dept_head", "leadership", "analyst", "city_admin", "it_ops"] },
  { prefix: "/api/work-orders", upstream: "SLA", path: "/work-orders", roles: ["operator", "dept_head", "field_tech", "city_admin", "leadership", "analyst"] },
  { prefix: "/api/twin", upstream: "TWIN", path: "/twin", roles: STAFF },
  { prefix: "/api/notifications", upstream: "NOTIFY", path: "/notifications", roles: STAFF },
  { prefix: "/api/audit", upstream: "AUDIT", path: "/audit", roles: ["it_ops", "city_admin"] },
  { prefix: "/api/connectors", upstream: "CONNECTOR", path: "/connectors", roles: ["it_ops", "city_admin"] },
];

export function matchRoute(url: string) {
  const path = url.split("?")[0];
  return ROUTES.find((r) => path === r.prefix || path.startsWith(`${r.prefix}/`));
}

export function allowed(roles: Persona[], route: { roles: Persona[] }): boolean {
  return roles.includes("super_admin") || roles.some((r) => route.roles.includes(r));
}

/** Tenant from Keycloak group paths like "/tenants/delhi" or "/tenants/delhi/departments/water". */
export function tenantFromGroups(groups: string[] | undefined): string | undefined {
  for (const g of groups ?? []) {
    const m = /^\/?tenants\/([a-z][a-z0-9-]*)/.exec(g);
    if (m) return m[1];
  }
  return undefined;
}

export function departmentsFromGroups(groups: string[] | undefined): string[] {
  return (groups ?? []).map((g) => /departments\/([^/]+)/.exec(g)?.[1]).filter((x): x is string => !!x);
}

/** Landing workspace for the web app. */
export function homeFor(roles: Persona[]): string {
  const order: Array<[Persona, string]> = [
    ["super_admin", "/platform"], ["city_admin", "/admin"], ["leadership", "/overview"], ["operator", "/command-centre"],
    ["dept_head", "/department"], ["field_tech", "/field"], ["analyst", "/analytics"], ["it_ops", "/ops"], ["citizen", "/citizen"],
  ];
  return order.find(([r]) => roles.includes(r))?.[1] ?? "/citizen";
}
