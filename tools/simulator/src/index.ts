/**
 * SCaaS device simulator. Sends batches to ingest-service (HTTP -> Kafka), exactly like a real integrator.
 *   npm run simulate                       # all demo cities, every 10 s, random incident every 3 min
 *   npm run simulate -- --once             # one batch and exit
 *   npm run simulate -- --scenario=storm   # trigger a scenario immediately
 *   npm run simulate -- --list-scenarios
 * Env: INGEST_URL, SIM_TENANTS="delhi=<apiKey>,bengaluru=<apiKey>", SIM_INTERVAL_SEC, SIM_INCIDENT_EVERY_MIN, SIM_SCALE
 */
import { CITIES } from "./cities.ts";
import { buildFleet, sample, rng, TYPE_NAMES, type SimDevice } from "./fleet.ts";
import { SCENARIOS } from "./scenarios.ts";

const args = new Map<string, string>(process.argv.slice(2).map((a: string): [string, string] => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "true"]; }));
const INGEST_URL = (process.env.INGEST_URL ?? "http://localhost:8091").replace(/\/$/, "");
const INTERVAL = Number(process.env.SIM_INTERVAL_SEC ?? 10) * 1000;
const INCIDENT_EVERY = Number(process.env.SIM_INCIDENT_EVERY_MIN ?? 3) * 60_000;
const SCALE = Number(process.env.SIM_SCALE ?? 1);
const TENANTS = (process.env.SIM_TENANTS ?? "delhi=sk_delhi_demo_0000000000000000000001,bengaluru=sk_bengaluru_demo_000000000000000000001")
  .split(",").map((p: string) => p.split("=")).filter(([t]: string[]) => CITIES[t]);

if (args.has("list-scenarios")) {
  for (const s of SCENARIOS) console.log(`${s.name.padEnd(18)} ${s.description}`);
  process.exit(0);
}

const noise = rng(Date.now() % 100000);
const pick = <T,>(xs: T[]): T => xs[Math.floor(noise() * xs.length)];
const fleets = TENANTS.map(([tenantId, apiKey]: string[]) => ({ tenantId, apiKey, devices: buildFleet(CITIES[tenantId], SCALE) }));

function records(devices: SimDevice[], now: number) {
  return devices.map((d) => ({
    deviceId: d.id,
    deviceType: TYPE_NAMES[d.kind],
    ts: now,
    zone: d.zone,
    location: { lat: d.lat, lon: d.lon },
    values: sample(d, now, noise),
  }));
}

async function send(tenantId: string, apiKey: string, recs: unknown[]) {
  for (let i = 0; i < recs.length; i += 1000) {
    const res = await fetch(`${INGEST_URL}/v1/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ records: recs.slice(i, i + 1000) }),
    });
    const body = (await res.json().catch(() => ({}))) as { accepted?: number; rejected?: unknown[] };
    if (!res.ok && res.status !== 202) throw new Error(`${tenantId}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    if (body.rejected?.length) console.warn(`${tenantId}: ${body.rejected.length} records rejected`, JSON.stringify(body.rejected.slice(0, 3)));
  }
}

async function tick() {
  const now = Date.now();
  for (const f of fleets) {
    try {
      await send(f.tenantId, f.apiKey, records(f.devices, now));
    } catch (err) {
      console.error(`[${new Date().toISOString()}] send failed:`, (err as Error).message);
    }
  }
}

function trigger(name?: string) {
  for (const f of fleets) {
    const s = name ? SCENARIOS.find((x) => x.name === name) : pick(SCENARIOS);
    if (!s) { console.error(`Unknown scenario ${name}. Use --list-scenarios.`); process.exit(1); return; }
    const ids = s.run(f.devices, Date.now(), pick);
    console.log(`[${new Date().toISOString()}] ${f.tenantId}: scenario "${s.name}" on ${ids.join(", ")}`);
  }
}

console.log(`Simulating ${fleets.map((f) => `${f.tenantId} (${f.devices.length} devices)`).join(", ")} -> ${INGEST_URL}`);
if (args.has("scenario")) trigger(args.get("scenario"));
await tick();
if (!args.has("once")) {
  setInterval(() => void tick(), INTERVAL);
  if (INCIDENT_EVERY > 0 && !args.has("no-incidents")) setInterval(() => trigger(), INCIDENT_EVERY);
}
