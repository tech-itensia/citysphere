import { mockGet, mockMutate } from "./mock";

/** Auth + tenant state the API client needs; set by AuthProvider. */
export const session: { token?: string; tenantOverride?: string } = {};

type Listener = (demo: boolean) => void;
let demoMode = false;
const listeners = new Set<Listener>();
export const isDemo = () => demoMode;
export function onDemoChange(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; }
function setDemo(v: boolean) { if (v !== demoMode) { demoMode = v; listeners.forEach((l) => l(v)); } }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const DEMO_FALLBACK = (import.meta.env.VITE_DEMO_FALLBACK ?? "true") !== "false";

function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { ...extra };
  if (session.token) h.authorization = `Bearer ${session.token}`;
  if (session.tenantOverride) h["x-tenant-id"] = session.tenantOverride;
  return h;
}

/** GET with demo fallback: if the gateway is down (network error / 502-504), serve demo data instead. */
export async function apiGet<T = any>(path: string): Promise<T> {
  try {
    const res = await fetch(`/api${path}`, { headers: headers() });
    if (res.status >= 502 && res.status <= 504) throw new TypeError("gateway unavailable");
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? res.statusText);
    }
    setDemo(false);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError || !DEMO_FALLBACK) throw err;
    const mock = mockGet(path);
    if (mock === null || mock === undefined) throw err;
    setDemo(true);
    return mock as T;
  }
}

export async function apiSend<T = any>(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  if (demoMode) return mockMutate(method, path, body) as T;
  const res = await fetch(`/api${path}`, {
    method,
    headers: headers({ "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.message ?? res.statusText);
  return data as T;
}
