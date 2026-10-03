/** Minimal Keycloak admin client: city users live in group /tenants/<city> (departments as subgroups), personas are realm roles. */
import { env, HttpError } from "@scaas/common";

const KC = env("KEYCLOAK_URL", "http://keycloak:8080");
const REALM = env("KEYCLOAK_REALM", "scaas");
const ADMIN = env("KEYCLOAK_ADMIN", "admin");
const ADMIN_PASSWORD = env("KEYCLOAK_ADMIN_PASSWORD", "admin");
export const CITY_ROLES = ["city_admin", "leadership", "operator", "dept_head", "field_tech", "analyst", "it_ops", "citizen"];

let token: { value: string; exp: number } | undefined;
async function adminToken(): Promise<string> {
  if (token && token.exp > Date.now() + 10_000) return token.value;
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: ADMIN, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new HttpError(424, `Keycloak admin login failed (${res.status})`);
  const b = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: b.access_token, exp: Date.now() + b.expires_in * 1000 };
  return token.value;
}

async function kc<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${KC}/admin/realms/${REALM}${path}`, {
    method, headers: { authorization: `Bearer ${await adminToken()}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 409) throw new HttpError(409, "A user with that username or email already exists");
  if (!res.ok) throw new HttpError(res.status >= 500 ? 424 : res.status, `Keycloak ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  if (!text) return (res.headers.get("location") ?? "") as T;
  return JSON.parse(text) as T;
}

interface Group { id: string; name: string; path: string; subGroups?: Group[] }

async function findGroup(path: string): Promise<Group | undefined> {
  const parts = path.split("/").filter(Boolean);
  let list = await kc<Group[]>("GET", `/groups?search=${encodeURIComponent(parts[0])}&briefRepresentation=false`);
  let cur = list.find((g) => g.name === parts[0]);
  for (const p of parts.slice(1)) {
    if (!cur) return undefined;
    const kids = cur.subGroups?.length ? cur.subGroups : await kc<Group[]>("GET", `/groups/${cur.id}/children?max=500`).catch(() => [] as Group[]);
    cur = kids.find((g) => g.name === p);
  }
  return cur;
}

/** Ensure /tenants/<city>[/departments/<dept>] exists; returns the group id. */
export async function ensureGroup(tenantId: string, department?: string): Promise<string> {
  const chain = ["tenants", tenantId, ...(department ? ["departments", department] : [])];
  let parent: Group | undefined;
  for (let i = 0; i < chain.length; i++) {
    const path = `/${chain.slice(0, i + 1).join("/")}`;
    let g = await findGroup(path);
    if (!g) {
      if (!parent) await kc("POST", "/groups", { name: chain[i] });
      else await kc("POST", `/groups/${parent.id}/children`, { name: chain[i] });
      g = await findGroup(path);
    }
    parent = g;
  }
  return parent!.id;
}

export interface CityUser { id: string; username: string; email?: string; firstName?: string; lastName?: string; enabled: boolean; roles: string[]; department?: string; createdAt?: number }

export async function listCityUsers(tenantId: string): Promise<CityUser[]> {
  const root = await findGroup(`/tenants/${tenantId}`);
  if (!root) return [];
  const members = new Map<string, any>();
  const deptOf = new Map<string, string>();
  const collect = async (g: Group, dept?: string) => {
    for (const u of await kc<any[]>("GET", `/groups/${g.id}/members?max=1000`)) { members.set(u.id, u); if (dept) deptOf.set(u.id, dept); }
  };
  await collect(root);
  const depts = await findGroup(`/tenants/${tenantId}/departments`);
  if (depts) {
    const kids = depts.subGroups?.length ? depts.subGroups : await kc<Group[]>("GET", `/groups/${depts.id}/children?max=500`).catch(() => [] as Group[]);
    for (const d of kids) await collect(d, d.name);
  }
  const out: CityUser[] = [];
  for (const u of members.values()) {
    const roles = (await kc<any[]>("GET", `/users/${u.id}/role-mappings/realm`)).map((r) => r.name).filter((r: string) => CITY_ROLES.includes(r) || r === "super_admin");
    out.push({ id: u.id, username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName, enabled: u.enabled, roles, department: deptOf.get(u.id), createdAt: u.createdTimestamp });
  }
  return out.sort((a, b) => a.username.localeCompare(b.username));
}

export async function createCityUser(tenantId: string, u: { username: string; email?: string; firstName?: string; lastName?: string; role: string; department?: string; password: string; temporary: boolean }) {
  const loc = await kc<string>("POST", "/users", {
    username: u.username, email: u.email, firstName: u.firstName, lastName: u.lastName, enabled: true, emailVerified: !!u.email,
    credentials: [{ type: "password", value: u.password, temporary: u.temporary }],
  });
  const id = loc.split("/").pop()!;
  await setRole(id, u.role);
  await kc("PUT", `/users/${id}/groups/${await ensureGroup(tenantId, u.department)}`);
  return id;
}

export async function setRole(userId: string, role: string) {
  const current = await kc<any[]>("GET", `/users/${userId}/role-mappings/realm`);
  const remove = current.filter((r) => CITY_ROLES.includes(r.name) && r.name !== role);
  if (remove.length) await kc("DELETE", `/users/${userId}/role-mappings/realm`, remove);
  const rep = await kc<any>("GET", `/roles/${role}`);
  await kc("POST", `/users/${userId}/role-mappings/realm`, [rep]);
}

export async function setEnabled(userId: string, enabled: boolean) { await kc("PUT", `/users/${userId}`, { enabled }); }
export async function resetPassword(userId: string, password: string) { await kc("PUT", `/users/${userId}/reset-password`, { type: "password", value: password, temporary: true }); }
export async function userInTenant(tenantId: string, userId: string) { return (await listCityUsers(tenantId)).some((u) => u.id === userId); }
