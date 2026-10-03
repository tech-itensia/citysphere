import cors from "@fastify/cors";
import {
  createApp, listen, env, envInt, getRedis, HttpError, internalHeaders, audit, logger, waitFor, inc, setGauge,
} from "@scaas/common";
import { identify, type Identity } from "./auth.ts";
import { matchRoute, allowed, homeFor } from "./access.ts";
import { addClient, startStream, clientCount } from "./stream.ts";

const UPSTREAMS: Record<string, string> = {
  TENANT: env("TENANT_SERVICE_URL", "http://tenant-service:3000"),
  INCIDENT: env("INCIDENT_SERVICE_URL", "http://incident-service:3000"),
  SLA: env("SLA_SERVICE_URL", "http://sla-workorder-service:3000"),
  TWIN: env("TWIN_SERVICE_URL", "http://tb-bridge-service:3000"),
  NOTIFY: env("NOTIFICATION_SERVICE_URL", "http://notification-service:3000"),
  AUDIT: env("AUDIT_SERVICE_URL", "http://audit-service:3000"),
  CONNECTOR: env("CONNECTOR_SERVICE_URL", "http://connector-service:3000"),
};
const RATE_PER_MIN = envInt("GATEWAY_RATE_PER_MIN", 600);
const redis = getRedis();

const app = createApp({ bodyLimit: 20 * 1024 * 1024 });
await app.register(cors, { origin: env("CORS_ORIGINS", "http://localhost:5173").split(","), credentials: true });
app.addContentTypeParser("text/csv", { parseAs: "string" }, (_r: any, body: string, done: (e: Error | null, b?: string) => void) => done(null, body));

async function who(req: any): Promise<Identity> {
  const auth = req.headers.authorization ?? (req.query?.access_token ? `Bearer ${req.query.access_token}` : undefined);
  const id = await identify(auth, req.headers["x-tenant-id"]);
  const k = `ratelimit:gw:${id.userId}:${Math.floor(Date.now() / 60000)}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, 70);
  if (n > RATE_PER_MIN) throw new HttpError(429, "Too many requests");
  return id;
}

function forwardHeaders(id: Identity, req: any): Record<string, string> {
  return internalHeaders({
    "content-type": req.headers["content-type"] ?? "application/json",
    "x-tenant-id": id.tenantId,
    "x-user-id": id.userId,
    "x-user-name": id.userName,
    "x-user-roles": id.roles.join(","),
    "x-user-departments": id.departments.join(","),
    "x-request-id": String(req.id),
  });
}

async function call(upstream: string, path: string, id: Identity, req: any) {
  const res = await fetch(`${UPSTREAMS[upstream]}${path}`, { headers: forwardHeaders(id, req) });
  if (!res.ok) throw new HttpError(res.status, `${upstream} ${path} failed`);
  return res.json();
}

// ---------------------------------------------------------------- identity
app.get("/api/me", async (req: any) => {
  const id = await who(req);
  return { ...id, home: homeFor(id.roles) };
});

// ---------------------------------------------------------------- leadership overview (one call, cached 5 s)
app.get("/api/overview", async (req: any) => {
  const id = await who(req);
  if (!allowed(id.roles, { roles: ["leadership", "operator", "dept_head", "analyst", "city_admin", "it_ops"] })) throw new HttpError(403, "Forbidden");
  const cacheKey = `t:${id.tenantId}:overview`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);
  const [twin, incidents, sla, tenant, recent, weather] = await Promise.all([
    call("TWIN", "/twin/summary", id, req),
    call("INCIDENT", "/incidents/stats", id, req),
    call("SLA", "/sla/summary", id, req),
    call("TENANT", `/tenants/${id.tenantId}`, id, req).catch(() => undefined),
    call("INCIDENT", "/incidents?open=true&limit=8", id, req),
    call("TWIN", `/twin/devices?type=${encodeURIComponent("Weather Feed")}`, id, req).catch(() => []),
  ]);
  const body = { generatedAt: new Date().toISOString(), tenant, twin, incidents, sla, recentAlerts: recent, weather: (weather as any[])[0]?.values ?? null };
  await redis.set(cacheKey, JSON.stringify(body), "EX", 5);
  return body;
});

// ---------------------------------------------------------------- live updates (Server-Sent Events)
app.get("/api/stream", async (req: any, reply: any) => {
  const id = await who(req);
  reply.hijack(); // we own the raw socket from here
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": req.headers.origin ?? "*",
    "access-control-allow-credentials": "true",
  });
  const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("hello", { tenantId: id.tenantId, roles: id.roles });
  const remove = addClient({ tenantId: id.tenantId, roles: id.roles, send });
  const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
  setGauge("gateway_sse_clients", clientCount());
  req.raw.on("close", () => { clearInterval(ping); remove(); setGauge("gateway_sse_clients", clientCount()); });
});

// ---------------------------------------------------------------- system health (IT Ops)
const HEALTH_TARGETS: Record<string, string> = {
  "tenant-service": UPSTREAMS.TENANT, "incident-service": UPSTREAMS.INCIDENT, "sla-workorder-service": UPSTREAMS.SLA,
  "tb-bridge-service": UPSTREAMS.TWIN, "notification-service": UPSTREAMS.NOTIFY, "audit-service": UPSTREAMS.AUDIT,
  "connector-service": UPSTREAMS.CONNECTOR,
  "ingest-service": env("INGEST_SERVICE_URL", "http://ingest-service:3000"),
  "normalizer-service": env("NORMALIZER_SERVICE_URL", "http://normalizer-service:3000"),
  "correlation-service": env("CORRELATION_SERVICE_URL", "http://correlation-service:3000"),
};
app.get("/api/system/health", async (req: any) => {
  const id = await who(req);
  if (!id.roles.some((r) => ["it_ops", "city_admin", "super_admin"].includes(r))) throw new HttpError(403, "IT Ops only");
  const checks = await Promise.all(Object.entries(HEALTH_TARGETS).map(async ([service, base]) => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      return { service, status: res.ok ? "up" : "down", latencyMs: Date.now() - t0 };
    } catch {
      return { service, status: "down", latencyMs: Date.now() - t0 };
    }
  }));
  return [{ service: "api-gateway", status: "up", latencyMs: 0 }, ...checks];
});

// ---------------------------------------------------------------- generic proxy
app.all("/api/*", async (req: any, reply: any) => {
  const route = matchRoute(req.url);
  if (!route) throw new HttpError(404, "Unknown API route");
  const id = await who(req);
  if (!allowed(id.roles, route)) throw new HttpError(403, `Persona ${id.roles.join(",")} cannot access ${route.prefix}`);

  const rest = req.url.slice(route.prefix.length);
  const target = `${UPSTREAMS[route.upstream]}${route.path}${rest}`;
  const hasBody = !["GET", "HEAD", "DELETE"].includes(req.method);
  const res = await fetch(target, {
    method: req.method,
    headers: forwardHeaders(id, req),
    body: hasBody ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {})) : undefined,
  });
  inc("gateway_proxy_total", { upstream: route.upstream, status: String(res.status) });
  if (hasBody || req.method === "DELETE") {
    void audit({ tenantId: id.tenantId, actor: id.userName, action: `${req.method} ${route.prefix}`, resource: req.url.split("?")[0], data: { status: res.status, ip: req.ip } });
  }
  reply.code(res.status).header("content-type", res.headers.get("content-type") ?? "application/json");
  return reply.send(Buffer.from(await res.arrayBuffer()));
});

await waitFor("kafka", () => startStream());
await listen(app);
logger.info("api-gateway ready");
