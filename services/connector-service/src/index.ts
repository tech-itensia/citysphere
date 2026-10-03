import {
  createApp, listen, ctx, requireRole, publish, makeEvent, Topics, logger, env, envInt, internalHeaders, waitFor, getProducer, inc,
} from "@scaas/common";
import { parseCsv } from "./csv.ts";

const TENANT_SERVICE_URL = env("TENANT_SERVICE_URL", "http://tenant-service:3000");
const WEATHER_PROVIDER = env("WEATHER_PROVIDER", "open-meteo"); // open-meteo | simulated | none
const WEATHER_EVERY_MIN = envInt("WEATHER_INTERVAL_MIN", 10);
const EVENTS_PROVIDER = env("EVENTS_PROVIDER", "demo"); // demo | none
const TRAFFIC_URL = process.env.TRAFFIC_FEED_URL; // optional JSON feed: [{id, lat, lon, speedKmh, vehicleCount, zone}]

interface Tenant { id: string; center: { lat: number; lon: number }; zones: Array<{ name: string; lat: number; lon: number }>; status: string }

const app = createApp({ internalOnly: true, bodyLimit: 20 * 1024 * 1024 });
app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req: any, body: string, done: (e: Error | null, b?: string) => void) => done(null, body));

async function tenants(): Promise<Tenant[]> {
  const res = await fetch(`${TENANT_SERVICE_URL}/internal/tenants`, { headers: internalHeaders() });
  if (!res.ok) throw new Error(`tenant-service ${res.status}`);
  return (await res.json()) as Tenant[];
}

async function emit(tenantId: string, connector: string, records: Array<{ deviceId: string; ts?: string | number; [k: string]: unknown }>) {
  if (!records.length) return;
  await publish(Topics.rawExternal, records.map((r) => makeEvent({
    type: "external.observed", tenantId, source: `connector:${connector}`, entity: { type: "DEVICE", id: r.deviceId },
    occurredAt: (r.ts as string | number | undefined) ?? Date.now(), data: r,
  })));
  inc("connector_records_total", { tenant: tenantId, connector }, records.length);
}

// ---------------------------------------------------------------- weather (Open-Meteo, no API key)
async function weatherFor(t: Tenant) {
  let values: Record<string, number>;
  if (WEATHER_PROVIDER === "open-meteo") {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${t.center.lat}&longitude=${t.center.lon}&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code`;
    const res = await fetch(u);
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const cur = ((await res.json()) as { current: Record<string, number> }).current;
    values = { temperatureC: cur.temperature_2m, humidity: cur.relative_humidity_2m, rainMm: cur.precipitation, windKmh: cur.wind_speed_10m, weatherCode: cur.weather_code };
  } else {
    const h = new Date().getHours();
    values = { temperatureC: 24 + 8 * Math.sin(((h - 9) / 24) * 2 * Math.PI), humidity: 55, rainMm: 0, windKmh: 9, weatherCode: 1 };
  }
  await emit(t.id, "weather", [{ deviceId: `WX-${t.id}`, deviceType: "Weather Feed", values, location: t.center }]);
}

// ---------------------------------------------------------------- public events (demo schedule)
function demoEvents(t: Tenant) {
  const now = new Date();
  const h = now.getHours();
  return t.zones.slice(0, 2).map((z, i) => {
    const start = 17 + i * 2; // evening events
    const active = h >= start && h < start + 3;
    return {
      deviceId: `EV-${t.id}-${z.name.replace(/\W+/g, "-").toLowerCase()}`,
      deviceType: "City Event Feed",
      zone: z.name,
      location: { lat: z.lat, lon: z.lon },
      values: { title: i === 0 ? "Evening concert" : "Street festival", expectedCrowd: i === 0 ? 12000 : 6000, active, roadClosure: active && i === 0, startsAtHour: start },
    };
  });
}

// ---------------------------------------------------------------- traffic (generic JSON adapter)
async function trafficFeed(t: Tenant) {
  if (!TRAFFIC_URL) return;
  const res = await fetch(TRAFFIC_URL.replace("{tenant}", t.id));
  if (!res.ok) throw new Error(`traffic feed ${res.status}`);
  const rows = (await res.json()) as Array<{ id: string; lat: number; lon: number; speedKmh: number; vehicleCount?: number; zone?: string }>;
  await emit(t.id, "traffic", rows.map((r) => ({
    deviceId: r.id.startsWith("TJ-") ? r.id : `TJ-${r.id}`, deviceType: "Traffic Junction", zone: r.zone,
    location: { lat: r.lat, lon: r.lon }, values: { speedKmh: r.speedKmh, vehicleCount: r.vehicleCount ?? 0 },
  })));
}

async function runAll(job: (t: Tenant) => Promise<void>, name: string) {
  try {
    for (const t of (await tenants()).filter((x) => x.status === "active")) {
      await job(t).catch((err) => logger.warn({ err, tenant: t.id, job: name }, "connector run failed"));
    }
  } catch (err) {
    logger.warn({ err, job: name }, "could not list tenants");
  }
}

// ---------------------------------------------------------------- batch upload (via api-gateway)
app.post("/connectors/batch", async (req: any) => {
  const c = ctx(req);
  requireRole(c, "it_ops", "city_admin");
  const text = typeof req.body === "string" ? req.body : String(req.body?.csv ?? "");
  const { records, errors } = parseCsv(text);
  for (let i = 0; i < records.length; i += 500) await emit(c.tenantId, "batch", records.slice(i, i + 500).map((r) => ({ ...r })));
  return { accepted: records.length, errors };
});

app.get("/connectors", async () => ({
  weather: { provider: WEATHER_PROVIDER, intervalMin: WEATHER_EVERY_MIN },
  events: { provider: EVENTS_PROVIDER },
  traffic: { provider: TRAFFIC_URL ? "http-json" : "none (use device simulator or ingest API)" },
  batch: { endpoint: "POST /api/connectors/batch (text/csv)" },
}));

await waitFor("kafka", () => getProducer());
await listen(app);
logger.info("connector-service ready");

if (WEATHER_PROVIDER !== "none") {
  setTimeout(() => void runAll(weatherFor, "weather"), 20_000);
  setInterval(() => void runAll(weatherFor, "weather"), WEATHER_EVERY_MIN * 60_000);
}
if (EVENTS_PROVIDER === "demo") setInterval(() => void runAll(async (t) => emit(t.id, "events", demoEvents(t)), "events"), 5 * 60_000);
if (TRAFFIC_URL) setInterval(() => void runAll(trafficFeed, "traffic"), 60_000);
