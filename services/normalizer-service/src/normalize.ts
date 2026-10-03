import { NonRetryableError } from "@scaas/common/errors";
import type { EventEnvelope, Observation } from "@scaas/common";

/** Device-id prefix -> device type, used when a producer omits deviceType. */
export const PREFIX_TYPES: Record<string, string> = {
  SL: "Street Light",
  AQ: "Air Quality Station",
  TJ: "Traffic Junction",
  WN: "Water Node",
  PM: "Power Meter",
  WB: "Smart Bin",
  PK: "Parking Sensor",
  VH: "Vehicle",
  DR: "Drone",
  AT: "Air Taxi",
  ER: "Emergency Unit",
  WX: "Weather Feed",
  EV: "City Event Feed",
};

/** Common vendor key spellings -> platform key (Smart Data Model style names). */
export const KEY_ALIASES: Record<string, string> = {
  temp: "temperatureC",
  temperature: "temperatureC",
  hum: "humidity",
  rh: "humidity",
  "pm2.5": "pm25",
  pm2_5: "pm25",
  pm_25: "pm25",
  pm_10: "pm10",
  co2_ppm: "co2",
  power: "powerW",
  power_w: "powerW",
  energy: "energyKWh",
  fill: "fillPct",
  fill_level: "fillPct",
  battery_level: "battery",
  batt: "battery",
  speed: "speedKmh",
  pressure: "pressureBar",
  flow: "flowLpm",
};

const MAX_FUTURE_MS = 5 * 60_000;

interface RawData {
  deviceId?: string;
  deviceType?: string;
  values?: Record<string, unknown>;
  location?: { lat: number; lon: number };
  zone?: string;
  attributes?: Record<string, unknown>;
}

/** Accepts ISO strings and epoch-ms strings (ThingsBoard exports metadata.ts as a string). */
export function parseTs(v: string | number | undefined): number {
  if (v === undefined) return NaN;
  if (typeof v === "number") return v;
  return /^\d{10,}$/.test(v.trim()) ? Number(v) : Date.parse(v);
}

export function inferDeviceType(deviceId: string, given?: string): string {
  if (given && given.trim()) return given.trim();
  const prefix = deviceId.split(/[-_.:]/)[0]?.toUpperCase() ?? "";
  return PREFIX_TYPES[prefix] ?? "Generic Sensor";
}

function coerce(v: unknown): number | string | boolean | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return undefined;
    if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
    if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Number(t);
    return t;
  }
  return undefined;
}

/** Turn any raw envelope (ingest API, ThingsBoard export, connector) into one Observation. */
export function normalize(event: EventEnvelope<RawData>, now = Date.now()): Observation {
  const d = event.data ?? {};
  const deviceId = d.deviceId ?? event.entity?.id;
  if (!deviceId) throw new NonRetryableError("deviceId missing");
  if (!d.values || typeof d.values !== "object") throw new NonRetryableError("values missing");

  const values: Record<string, number | string | boolean> = {};
  let lat: number | undefined;
  let lon: number | undefined;

  for (const [rawKey, rawVal] of Object.entries(d.values)) {
    if (rawKey === "ingestSource") continue; // loop-prevention tag written by tb-bridge
    let key = KEY_ALIASES[rawKey] ?? KEY_ALIASES[rawKey.toLowerCase()] ?? rawKey;
    let val = coerce(rawVal);
    if (val === undefined) continue;
    if (/^(lat|latitude)$/i.test(key) && typeof val === "number") { lat = val; continue; }
    if (/^(lon|lng|longitude)$/i.test(key) && typeof val === "number") { lon = val; continue; }
    if (/F$/.test(key) && /^temp/i.test(key) && typeof val === "number") {
      key = key.replace(/F$/, "C");
      val = Math.round(((val - 32) * 5 / 9) * 100) / 100;
    }
    values[key] = val;
  }
  if (Object.keys(values).length === 0 && lat === undefined) throw new NonRetryableError("no usable values");

  let ts = parseTs(event.occurredAt);
  if (!Number.isFinite(ts) || ts > now + MAX_FUTURE_MS) ts = now;

  const location = d.location ?? (lat !== undefined && lon !== undefined ? { lat, lon } : undefined);

  return {
    deviceId,
    deviceType: inferDeviceType(deviceId, d.deviceType),
    ts,
    values,
    location,
    zone: d.zone,
    attributes: d.attributes,
    origin: event.source,
  };
}
