import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { logger } from "./logger.ts";
import { common } from "./config.ts";
import { HttpError } from "./errors.ts";
import { renderMetrics, inc } from "./metrics.ts";
import { onShutdown } from "./lifecycle.ts";
import type { Persona } from "./schemas.ts";

export interface RequestContext {
  tenantId: string;
  userId: string;
  userName: string;
  roles: Persona[];
  requestId: string;
}

export interface AppOptions {
  /** Require the x-internal-token header (set by api-gateway / other services) on every non-public route. */
  internalOnly?: boolean;
  /** Paths that skip the internal-token check. */
  publicPaths?: string[];
  ready?: () => Promise<boolean>;
  bodyLimit?: number;
}

/** Fastify app with health, readiness, Prometheus metrics, a uniform error format and internal auth. */
export function createApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ loggerInstance: logger, bodyLimit: opts.bodyLimit ?? 5 * 1024 * 1024, trustProxy: true });
  const publicPaths = new Set(["/health", "/ready", "/metrics", ...(opts.publicPaths ?? [])]);

  app.get("/health", async () => ({ status: "ok", service: common.serviceName() }));
  app.get("/ready", async (_req, reply) => {
    const ok = opts.ready ? await opts.ready().catch(() => false) : true;
    return reply.code(ok ? 200 : 503).send({ ready: ok });
  });
  app.get("/metrics", async (_req, reply) => reply.type("text/plain; version=0.0.4").send(renderMetrics()));

  if (opts.internalOnly) {
    const token = common.internalToken();
    app.addHook("onRequest", async (req) => {
      const path = req.url.split("?")[0];
      if (publicPaths.has(path)) return;
      if (req.headers["x-internal-token"] !== token) throw new HttpError(401, "Internal token missing or invalid");
    });
  }

  app.addHook("onResponse", async (req, reply) => {
    inc("http_requests_total", { route: req.routeOptions.url ?? "unknown", method: req.method, status: String(reply.statusCode) });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "ValidationError", message: "Invalid request", issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.name, message: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "request failed");
    return reply.code(status).send({ error: status >= 500 ? "InternalError" : "RequestError", message: status >= 500 ? "Internal error" : (err as Error).message });
  });

  onShutdown(async () => { await app.close(); });
  return app;
}

export async function listen(app: FastifyInstance, port = common.port()): Promise<void> {
  await app.listen({ host: "0.0.0.0", port });
}

/** Caller identity forwarded by the api-gateway after it verified the user's token. */
export function ctx(req: FastifyRequest): RequestContext {
  const h = req.headers;
  const tenantId = String(h["x-tenant-id"] ?? "");
  if (!tenantId) throw new HttpError(400, "x-tenant-id header is required");
  return {
    tenantId,
    userId: String(h["x-user-id"] ?? "system"),
    userName: String(h["x-user-name"] ?? "system"),
    roles: String(h["x-user-roles"] ?? "").split(",").filter(Boolean) as Persona[],
    requestId: String(h["x-request-id"] ?? req.id),
  };
}

export function requireRole(c: RequestContext, ...allowed: Persona[]): void {
  if (c.roles.includes("super_admin")) return;
  if (!allowed.some((r) => c.roles.includes(r))) {
    throw new HttpError(403, `Requires one of: ${allowed.join(", ")}`);
  }
}

/** Headers for service-to-service calls. */
export function internalHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", "x-internal-token": common.internalToken(), ...extra };
}
