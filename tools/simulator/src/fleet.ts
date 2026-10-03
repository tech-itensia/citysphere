import type { CityDef } from "./cities.ts";

export type Kind = "SL" | "TJ" | "AQ" | "WN" | "PM" | "WB" | "PK" | "VH" | "DR" | "AT" | "ER" | "RG";

export const TYPE_NAMES: Record<Kind, string> = {
  SL: "Street Light", TJ: "Traffic Junction", AQ: "Air Quality Station", WN: "Water Node", PM: "Power Meter",
  WB: "Smart Bin", PK: "Parking Sensor", VH: "Vehicle", DR: "Drone", AT: "Air Taxi", ER: "Emergency Unit",
  RG: "Weather Feed",
};

const PER_ZONE: Partial<Record<Kind, number>> = { SL: 6, TJ: 2, AQ: 1, WN: 3, PM: 1, WB: 4, PK: 6 };
const CITY_WIDE: Partial<Record<Kind, number>> = { VH: 4, DR: 2, AT: 1, ER: 2, RG: 1 };

export interface SimDevice {
  id: string;
  kind: Kind;
  zone?: string;
  lat: number;
  lon: number;
  state: Record<string, number | boolean | string>;
  /** Active fault injected by a scenario: overrides values until `until`. */
  override?: { values: Record<string, number | boolean | string>; until: number };
  orbit?: { cLat: number; cLon: number; r: number; phase: number; speed: number };
}

/** Deterministic pseudo-random so a fleet is the same on every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "").slice(0, 6).toUpperCase();

export function buildFleet(city: CityDef, scale = 1): SimDevice[] {
  const r = rng(city.tenantId.length * 7919);
  const jitter = () => (r() - 0.5) * 0.02;
  const out: SimDevice[] = [];
  for (const z of city.zones) {
    for (const [kind, n] of Object.entries(PER_ZONE) as Array<[Kind, number]>) {
      for (let i = 1; i <= Math.max(1, Math.round(n * scale)); i++) {
        out.push({ id: `${kind}-${slug(z.name)}-${String(i).padStart(2, "0")}`, kind, zone: z.name, lat: z.lat + jitter(), lon: z.lon + jitter(), state: {} });
      }
    }
  }
  for (const [kind, n] of Object.entries(CITY_WIDE) as Array<[Kind, number]>) {
    for (let i = 1; i <= n; i++) {
      const z = city.zones[(i - 1) % city.zones.length];
      out.push({
        id: `${kind}-${city.tenantId.toUpperCase().slice(0, 3)}-${String(i).padStart(2, "0")}`, kind, zone: z.name, lat: z.lat, lon: z.lon, state: {},
        orbit: kind === "RG" ? undefined : { cLat: city.center.lat, cLon: city.center.lon, r: 0.02 + r() * 0.04, phase: r() * Math.PI * 2, speed: kind === "VH" ? 0.002 : 0.006 },
      });
    }
  }
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** Telemetry for one device at simulated time `t` (ms). `noise` in [0,1). */
export function sample(d: SimDevice, t: number, noise: () => number): Record<string, number | boolean | string> {
  const hour = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  const night = hour < 6 || hour >= 18.5;
  const rush = Math.exp(-((hour - 9) ** 2) / 2) + Math.exp(-((hour - 18) ** 2) / 2); // 0..1 traffic peaks
  const n = (a: number) => (noise() - 0.5) * 2 * a;
  let v: Record<string, number | boolean | string>;

  switch (d.kind) {
    case "SL": {
      const on = night;
      const energy = Number(d.state.energyKWh ?? 100 + noise() * 50) + (on ? 0.012 : 0);
      v = { status: on ? "ON" : "OFF", brightness: on ? 100 : 0, powerW: on ? round(72 + n(4)) : round(1.5 + n(0.3)), energyKWh: round(energy, 3), fault: false, battery: round(clamp(Number(d.state.battery ?? 90) + (on ? -0.02 : 0.05), 30, 100)) };
      break;
    }
    case "TJ":
      v = { vehicleCount: Math.round(40 + 160 * rush + n(15)), speedKmh: round(clamp(42 - 22 * rush + n(4), 18, 60)), queueLength: Math.round(3 + 25 * rush + n(3)), signalPhase: ["NS_GREEN", "EW_GREEN"][Math.floor(t / 60000) % 2], signalFault: false };
      break;
    case "AQ": {
      const pm25 = clamp(35 + 25 * rush + (night ? 10 : 0) + n(6), 5, 400);
      v = { pm25: round(pm25), pm10: round(pm25 * 1.7), no2: round(20 + 25 * rush + n(4)), co2: Math.round(420 + 60 * rush + n(10)), aqi: Math.round(pm25 * 1.9), noiseDb: round(55 + 15 * rush + n(3)), temperatureC: round(24 + 7 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + n(0.5)), humidity: round(55 + n(5)) };
      break;
    }
    case "WN":
      v = { flowLpm: round(400 + 300 * Math.exp(-((hour - 7) ** 2) / 3) + n(20)), pressureBar: round(3.2 + n(0.15), 2), turbidityNtu: round(1.2 + n(0.3), 2), levelPct: round(70 + n(3)), leak: false };
      break;
    case "PM": {
      const load = clamp(55 + 25 * Math.exp(-((hour - 20) ** 2) / 6) + 10 * rush + n(4), 10, 99);
      v = { voltage: round(230 + n(3)), currentA: round(load * 4.2), loadKw: round(load * 9.5), loadPct: round(load), powerFactor: round(0.93 + n(0.02), 2) };
      break;
    }
    case "WB": {
      const fill = Number(d.state.fillPct ?? noise() * 50) + 0.4 + noise() * 0.6;
      v = { fillPct: round(fill > 100 ? 5 : fill), temperatureC: round(28 + n(2)), battery: round(clamp(Number(d.state.battery ?? 95) - 0.001, 10, 100)) };
      break;
    }
    case "PK": {
      const occupied = noise() < 0.35 + 0.5 * rush;
      const dwell = occupied ? Number(d.state.dwellMin ?? 0) + 1 : 0;
      v = { occupied, dwellMin: dwell };
      break;
    }
    case "RG":
      v = { rainMm: 0, temperatureC: round(26 + n(1)), humidity: round(60 + n(5)), windKmh: round(8 + n(3)) };
      break;
    case "VH": case "DR": case "AT": case "ER": {
      const o = d.orbit!;
      const a = o.phase + (t / 1000) * o.speed * 0.1;
      d.lat = round(o.cLat + o.r * Math.sin(a), 5);
      d.lon = round(o.cLon + o.r * Math.cos(a), 5);
      const battery = clamp(Number(d.state.battery ?? 95) - (d.kind === "VH" ? 0.01 : 0.05), 35, 100);
      v = d.kind === "VH" ? { speedKmh: round(clamp(30 - 15 * rush + n(8), 0, 65)), heading: Math.round(((a * 180) / Math.PI) % 360), battery: round(battery), fuelPct: round(battery) }
        : d.kind === "ER" ? { available: noise() > 0.3, speedKmh: round(noise() * 50), assignment: "standby" }
        : { altitudeM: round(d.kind === "DR" ? 80 + n(10) : 350 + n(20)), speedKmh: round(d.kind === "DR" ? 35 + n(5) : 140 + n(10)), battery: round(battery < 36 ? 95 : battery), heading: Math.round(((a * 180) / Math.PI) % 360), ...(d.kind === "AT" ? { passengers: Math.floor(noise() * 4) } : {}) };
      break;
    }
  }
  if (d.override && d.override.until > t) Object.assign(v, d.override.values);
  else if (d.override) d.override = undefined;
  d.state = { ...d.state, ...v };
  return v;
}
