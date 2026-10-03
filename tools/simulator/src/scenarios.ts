import type { SimDevice, Kind } from "./fleet.ts";

/** Scripted incidents that trip ThingsBoard alarm rules (and the correlation rules) during a demo. */
export interface Scenario { name: string; description: string; run: (fleet: SimDevice[], now: number, pick: <T>(xs: T[]) => T) => string[] }

const min = 60_000;
const of = (fleet: SimDevice[], kind: Kind) => fleet.filter((d) => d.kind === kind);
function hit(devices: SimDevice[], values: Record<string, number | boolean | string>, now: number, minutes: number): string[] {
  for (const d of devices) d.override = { values, until: now + minutes * min };
  return devices.map((d) => d.id);
}
function sameZone(fleet: SimDevice[], kind: Kind, count: number, pick: <T>(xs: T[]) => T): SimDevice[] {
  const zones = [...new Set(of(fleet, kind).map((d) => d.zone))];
  const zone = pick(zones);
  return of(fleet, kind).filter((d) => d.zone === zone).slice(0, count);
}

export const SCENARIOS: Scenario[] = [
  { name: "lamp-fault", description: "A street light fails (Lamp Fault, MAJOR)", run: (f, now, pick) => hit([pick(of(f, "SL"))], { fault: true, powerW: 0, status: "FAULT" }, now, 10) },
  { name: "bin-overflow", description: "A bin passes 85% fill (Bin Almost Full, MAJOR)", run: (f, now, pick) => {
    const d = pick(of(f, "WB"));
    d.state.fillPct = 5; // emptied when the override ends
    return hit([d], { fillPct: 93 }, now, 15);
  } },
  { name: "bin-fire", description: "Bin temperature spikes (Bin Fire Risk, CRITICAL)", run: (f, now, pick) => hit([pick(of(f, "WB"))], { temperatureC: 71 }, now, 6) },
  { name: "pollution-spike", description: "PM2.5 above 120 (High PM2.5, CRITICAL)", run: (f, now, pick) => hit([pick(of(f, "AQ"))], { pm25: 142, pm10: 238, aqi: 270 }, now, 15) },
  { name: "water-main-break", description: "3 nodes in one zone lose pressure (correlated: Possible Water Main Break, CRITICAL)", run: (f, now, pick) => hit(sameZone(f, "WN", 3, pick), { pressureBar: 0.8, flowLpm: 1300 }, now, 20) },
  { name: "leak", description: "Leak detector trips (Leak Suspected, CRITICAL)", run: (f, now, pick) => hit([pick(of(f, "WN"))], { leak: true }, now, 10) },
  { name: "feeder-overload", description: "Feeder load above 100% (Feeder Overload, CRITICAL)", run: (f, now, pick) => hit([pick(of(f, "PM"))], { loadPct: 104, currentA: 437 }, now, 10) },
  { name: "power-outage", description: "Voltage drops to 0 (Power Outage, CRITICAL)", run: (f, now, pick) => hit([pick(of(f, "PM"))], { voltage: 0, loadPct: 0, currentA: 0 }, now, 5) },
  { name: "congestion", description: "Two junctions in one zone crawl below 15 km/h for 5+ min (Congestion)", run: (f, now, pick) => hit(sameZone(f, "TJ", 2, pick), { speedKmh: 9, queueLength: 64, vehicleCount: 310 }, now, 15) },
  { name: "signal-fault", description: "Traffic signal controller fault (Signal Fault, CRITICAL)", run: (f, now, pick) => hit([pick(of(f, "TJ"))], { signalFault: true }, now, 8) },
  { name: "drone-battery", description: "Drone battery drops to 12% (Drone Low Battery, MAJOR)", run: (f, now, pick) => hit([pick(of(f, "DR"))], { battery: 12 }, now, 8) },
  { name: "storm", description: "Heavy rain + congestion at 2 junctions (Heavy Rain + correlated Rain-Induced Congestion)", run: (f, now, pick) => [
    ...hit(of(f, "RG"), { rainMm: 26 }, now, 30),
    ...hit(sameZone(f, "TJ", 2, pick), { speedKmh: 8, queueLength: 70, vehicleCount: 280 }, now, 20),
  ] },
];
