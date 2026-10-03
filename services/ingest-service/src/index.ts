import {
  createApp, listen, publish, Topics, inc, getRedis, envInt, HttpError, logger, getProducer, waitFor,
} from "@scaas/common";
import { authenticate } from "./auth.ts";
import { buildEvents, recordFromDeviceBody, MAX_BATCH } from "./ingest.ts";

const RATE_PER_SEC = envInt("INGEST_RATE_PER_SEC", 2000);

const app = createApp({ publicPaths: ["/v1/schema"], bodyLimit: 10 * 1024 * 1024 });
const redis = getRedis();

/** Fixed one-second window per tenant key, counted in records. */
async function rateLimit(keyId: string, records: number): Promise<void> {
  const k = `ratelimit:ingest:${keyId}:${Math.floor(Date.now() / 1000)}`;
  const used = await redis.incrby(k, records);
  if (used === records) await redis.expire(k, 2);
  if (used > RATE_PER_SEC) throw new HttpError(429, `Rate limit ${RATE_PER_SEC} records/s exceeded`);
}

async function accept(headers: Record<string, unknown>, body: unknown) {
  const caller = await authenticate(headers);
  const { events, rejected } = buildEvents(caller.tenantId, body);
  if (events.length) {
    await rateLimit(caller.keyId, events.length);
    await publish(Topics.rawTelemetry, events);
  }
  inc("ingest_records_total", { tenant: caller.tenantId, status: "accepted" }, events.length, "Telemetry records accepted");
  inc("ingest_records_total", { tenant: caller.tenantId, status: "rejected" }, rejected.length);
  return { accepted: events.length, rejected, eventIds: events.map((e) => e.eventId) };
}

/** Single record, array, or { records: [...] } (max 1000). */
app.post("/v1/telemetry", async (req: any, reply: any) => {
  const result = await accept(req.headers, req.body);
  return reply.code(result.accepted > 0 ? 202 : 400).send(result);
});

/** Convenience: POST /v1/devices/SL-001/telemetry  { "powerW": 42, "status": "ON" } */
app.post("/v1/devices/:deviceId/telemetry", async (req: any, reply: any) => {
  const record = recordFromDeviceBody(req.params.deviceId, req.body ?? {}, req.query?.ts);
  const result = await accept(req.headers, record);
  return reply.code(result.accepted > 0 ? 202 : 400).send(result);
});

app.get("/v1/schema", async () => ({
  maxBatch: MAX_BATCH,
  auth: "x-api-key header (tenant API key with telemetry:write scope)",
  record: {
    deviceId: "string, required, [A-Za-z0-9._:-], unique per tenant",
    deviceType: "string, optional: Street Light | Air Quality Station | Traffic Junction | Water Node | Power Meter | Smart Bin | Parking Sensor | Vehicle | Drone | ...",
    ts: "epoch ms or ISO-8601, optional (defaults to receive time)",
    values: "object of number | string | boolean, required",
    location: "{ lat, lon }, optional",
    zone: "zone asset name, optional",
    attributes: "object, optional static metadata",
  },
  kafkaTopic: Topics.rawTelemetry,
}));

await waitFor("kafka", () => getProducer());
await listen(app);
logger.info("ingest-service ready");
