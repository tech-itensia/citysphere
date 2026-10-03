/**
 * Demo data used ONLY when the API gateway is unreachable (the UI shows a "Demo data" badge).
 * Shapes match the real service responses, so every screen can be built and demoed before the backend is up.
 */
type Any = Record<string, any>;

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const uuid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(rnd() * 16).toString(16));
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const CENTER = { lat: 28.6139, lon: 77.209 };
const ZONES = [
  { name: "Connaught Place", lat: 28.6315, lon: 77.2167 },
  { name: "Karol Bagh", lat: 28.6514, lon: 77.1907 },
  { name: "Dwarka Sector 18", lat: 28.5921, lon: 77.046 },
  { name: "Mahipalpur", lat: 28.545, lon: 77.126 },
  { name: "Saket", lat: 28.5245, lon: 77.2066 },
];
const TYPES: Array<[string, string, string, number]> = [
  ["SL", "Street Light", "lighting", 6], ["TJ", "Traffic Junction", "traffic", 2], ["AQ", "Air Quality Station", "environment", 1],
  ["WN", "Water Node", "water", 3], ["PM", "Power Meter", "electricity", 1], ["WB", "Smart Bin", "waste", 4], ["PK", "Parking Sensor", "parking", 3],
];

function valuesFor(type: string): Any {
  switch (type) {
    case "Street Light": return { status: "ON", powerW: 70 + rnd() * 6, battery: 80 + rnd() * 20, fault: false };
    case "Traffic Junction": return { speedKmh: 18 + rnd() * 25, vehicleCount: Math.round(80 + rnd() * 140), queueLength: Math.round(rnd() * 30) };
    case "Air Quality Station": return { pm25: 30 + rnd() * 40, aqi: Math.round(60 + rnd() * 90), noiseDb: 55 + rnd() * 15, temperatureC: 29 + rnd() * 3 };
    case "Water Node": return { pressureBar: 2.8 + rnd() * 0.6, flowLpm: 380 + rnd() * 120, turbidityNtu: 1 + rnd() };
    case "Power Meter": return { loadPct: 55 + rnd() * 30, voltage: 228 + rnd() * 5 };
    case "Smart Bin": return { fillPct: Math.round(rnd() * 90), temperatureC: 28 + rnd() * 3 };
    case "Parking Sensor": return { occupied: rnd() > 0.4 };
    case "Drone": return { altitudeM: 80, battery: 60 + rnd() * 30, speedKmh: 35 };
    case "Air Taxi": return { altitudeM: 350, battery: 70 + rnd() * 20, passengers: 2 };
    case "Emergency Unit": return { available: rnd() > 0.3 };
    case "Vehicle": return { speedKmh: 20 + rnd() * 20, fuelPct: 70 };
    default: return {};
  }
}

const DOMAIN_OF: Record<string, string> = {
  "Street Light": "lighting", "Traffic Junction": "traffic", "Air Quality Station": "environment", "Water Node": "water", "Power Meter": "electricity",
  "Smart Bin": "waste", "Parking Sensor": "parking", Drone: "mobility", "Air Taxi": "mobility", "Emergency Unit": "emergency", Vehicle: "mobility", "Weather Feed": "weather",
};

export const devices: Any[] = [];
for (const z of ZONES) {
  for (const [prefix, type, domain, n] of TYPES) {
    for (let i = 1; i <= n; i++) {
      devices.push({
        deviceId: `${prefix}-${z.name.replace(/\W+/g, "").slice(0, 6).toUpperCase()}-0${i}`, deviceType: type, domain, zone: z.name,
        lat: z.lat + (rnd() - 0.5) * 0.02, lon: z.lon + (rnd() - 0.5) * 0.02, ts: Date.now() - rnd() * 60_000, values: valuesFor(type), online: true, alarms: [],
      });
    }
  }
}
for (const [prefix, type, n] of [["DR", "Drone", 3], ["AT", "Air Taxi", 2], ["ER", "Emergency Unit", 3], ["VH", "Vehicle", 4]] as Array<[string, string, number]>) {
  for (let i = 1; i <= n; i++) {
    devices.push({ deviceId: `${prefix}-DEL-0${i}`, deviceType: type, domain: DOMAIN_OF[type], zone: pick(ZONES).name,
      lat: CENTER.lat + (rnd() - 0.5) * 0.12, lon: CENTER.lon + (rnd() - 0.5) * 0.14, ts: Date.now(), values: valuesFor(type), online: true, alarms: [] });
  }
}
devices.push({ deviceId: "WX-delhi", deviceType: "Weather Feed", domain: "weather", lat: CENTER.lat, lon: CENTER.lon, ts: Date.now(),
  values: { temperatureC: 28, humidity: 62, rainMm: 0, windKmh: 9, weatherCode: 1 }, online: true, alarms: [] });

const CATS = ["traffic", "water", "electricity", "waste", "lighting", "environment"];
const TITLES: Record<string, string[]> = {
  traffic: ["Congestion at", "Signal Fault at"], water: ["Low Water Pressure at", "Leak Suspected at"], electricity: ["Feeder Overload at", "Power Outage at"],
  waste: ["Bin Almost Full at", "Bin Fire Risk at"], lighting: ["Lamp Fault at"], environment: ["High PM2.5 at"],
};
const DEPT: Record<string, string> = { traffic: "Traffic Police", water: "Water Supply", electricity: "Electricity", waste: "Solid Waste", lighting: "Street Lighting", environment: "Environment" };
const STATUSES = ["New", "New", "Acknowledged", "Assigned", "In Progress", "Resolved", "Closed"];

export const incidents: Any[] = Array.from({ length: 26 }, (_, i) => {
  const category = pick(CATS);
  const d = pick(devices.filter((x) => x.domain === category)) ?? devices[0];
  const severity = pick(["Critical", "High", "High", "Medium", "Medium", "Low"]);
  const age = rnd() * 6 * 3600_000;
  const status = pick(STATUSES);
  return {
    id: uuid(), ref: `INC-${String(1040 + i).padStart(6, "0")}`, tenantId: "delhi", title: `${pick(TITLES[category])} ${d.deviceId}`,
    description: "Raised automatically by ThingsBoard alarm rule.", category, severity, status, source: rnd() > 0.85 ? "citizen" : "alarm",
    deviceId: d.deviceId, deviceType: d.deviceType, zone: d.zone, lat: d.lat, lon: d.lon, department: DEPT[category],
    assignee: ["Assigned", "In Progress"].includes(status) ? "tech.delhi" : undefined, escalationLevel: rnd() > 0.85 ? 1 : 0,
    createdAt: iso(age), updatedAt: iso(age / 2), acknowledgedAt: status !== "New" ? iso(age - 120_000) : undefined,
  };
}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

export const workOrders: Any[] = incidents.filter((i) => ["Assigned", "In Progress", "Resolved", "Closed"].includes(i.status)).slice(0, 10).map((i, n) => ({
  id: uuid(), ref: `WO-${String(300 + n).padStart(6, "0")}`, incidentId: i.id, title: `Fix: ${i.title}`, status: pick(["Assigned", "Accepted", "In Progress", "On Hold", "Completed", "Verified"]),
  priority: i.severity, department: i.department, assignee: "tech.delhi", dueAt: iso(-4 * 3600_000), checklist: [{ item: "Inspect asset", done: true }, { item: "Repair / replace", done: false }],
  evidence: [], createdBy: "operator.delhi", createdAt: i.createdAt, updatedAt: i.updatedAt,
}));

function timelineFor(i: Any) {
  return [
    { type: "created", actor: i.source === "citizen" ? "citizen.delhi" : "thingsboard", data: {}, at: i.createdAt },
    ...(i.acknowledgedAt ? [{ type: "status.changed", actor: "operator.delhi", data: { from: "New", to: "Acknowledged", action: "acknowledge" }, at: i.acknowledgedAt }] : []),
  ];
}

function summary() {
  const byDomain = new Map<string, { total: number; healthy: number; offline: number; alarmed: number }>();
  const open = incidents.filter((i) => !["Resolved", "Closed", "Verified"].includes(i.status));
  for (const d of devices) {
    const s = byDomain.get(d.domain) ?? { total: 0, healthy: 0, offline: 0, alarmed: 0 };
    s.total++;
    const bad = open.some((i) => i.deviceId === d.deviceId && ["Critical", "High"].includes(i.severity));
    if (bad) s.alarmed++; else s.healthy++;
    byDomain.set(d.domain, s);
  }
  const domains = [...byDomain.entries()].map(([domain, s]) => {
    const healthPct = Math.round((s.healthy / s.total) * 1000) / 10;
    const status = healthPct >= 95 ? "Operational" : healthPct >= 85 ? "Moderate" : healthPct >= 70 ? "Attention" : "Critical";
    return { domain, ...s, healthPct, status };
  });
  const total = devices.length, healthy = domains.reduce((n, d) => n + d.healthy, 0);
  const statusCounts: Any = { Operational: 0, Moderate: 0, Attention: 0, Critical: 0 };
  for (const d of domains) statusCounts[d.status]++;
  return { overallScore: Math.round((healthy / total) * 1000) / 10, devices: total, activeAlarms: open.length, statusCounts, domains };
}

function stats() {
  const open = incidents.filter((i) => !["Resolved", "Closed", "Verified"].includes(i.status));
  const group = (k: string) => Object.entries(open.reduce((m: Any, i) => ((m[i[k] ?? "Unknown"] = (m[i[k] ?? "Unknown"] ?? 0) + 1), m), {}))
    .map(([key, count]) => ({ key, count })).sort((a: Any, b: Any) => b.count - a.count);
  return { total: incidents.length, open: open.length, createdToday: incidents.length, mttrMinutes: 96, bySeverity: group("severity"), byStatus: group("status"), byCategory: group("category"), byZone: group("zone") };
}

function trend(days: number) {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const created = Math.round(8 + Math.sin(i / 3) * 4 + rnd() * 6);
    return { day: d, created, resolved: Math.max(0, created - Math.round(rnd() * 4) + (i % 5 === 0 ? 2 : 0)) };
  });
}

function history(deviceId: string) {
  const d = devices.find((x) => x.deviceId === deviceId) ?? devices[0];
  const out: Any = {};
  for (const [k, v] of Object.entries(d.values)) {
    if (typeof v !== "number") continue;
    out[k] = Array.from({ length: 96 }, (_, i) => ({ ts: Date.now() - (95 - i) * 15 * 60_000, value: String(Math.round((v as number) * (0.85 + 0.3 * Math.abs(Math.sin(i / 9))) * 100) / 100) }));
  }
  return out;
}

const tenants = [
  { id: "delhi", name: "New Delhi Municipal Council", cityName: "New Delhi", center: CENTER, zones: ZONES, branding: { productName: "Smart City Operating System", logoText: "NDMC" }, status: "active", createdAt: iso(5 * 86_400_000) },
  { id: "bengaluru", name: "Bruhat Bengaluru Mahanagara Palike", cityName: "Bengaluru", center: { lat: 12.9716, lon: 77.5946 }, zones: [], branding: {}, status: "active", createdAt: iso(4 * 86_400_000) },
];

const SERVICES = ["api-gateway", "tenant-service", "ingest-service", "normalizer-service", "tb-bridge-service", "incident-service", "sla-workorder-service", "correlation-service", "notification-service", "audit-service", "connector-service"];

/** Route a GET path to demo data. */
export function mockGet(path: string): any {
  const [p, qs] = path.split("?");
  const q = new URLSearchParams(qs ?? "");
  if (p === "/me") return null;
  if (p === "/overview") {
    return {
      generatedAt: new Date().toISOString(), tenant: tenants[0], twin: summary(), incidents: stats(),
      sla: { open: { green: 9, amber: 3, red: 2 }, responseCompliancePct: 94.2, resolutionCompliancePct: 88.7, window: "30d" },
      recentAlerts: incidents.filter((i) => !["Resolved", "Closed"].includes(i.status)).slice(0, 8),
      weather: devices.find((d) => d.deviceType === "Weather Feed")?.values,
    };
  }
  if (p === "/twin/summary") return summary();
  if (p === "/twin/devices") {
    const type = q.get("type"), domain = q.get("domain");
    return devices.filter((d) => (!type || d.deviceType === type) && (!domain || d.domain === domain));
  }
  let m = /^\/twin\/devices\/([^/]+)\/history$/.exec(p);
  if (m) return history(decodeURIComponent(m[1]));
  m = /^\/twin\/devices\/([^/]+)$/.exec(p);
  if (m) {
    const d = devices.find((x) => x.deviceId === decodeURIComponent(m![1]));
    return { state: d, profile: d?.deviceType, attributes: [{ key: "installDate", value: "2025-11-04" }, { key: "vendor", value: "Acme IoT" }], activeAlarms: [] };
  }
  if (p === "/incidents/stats") return stats();
  if (p === "/incidents/trend") return trend(Number(q.get("days") ?? 30));
  m = /^\/incidents\/([^/]+)$/.exec(p);
  if (m) { const i = incidents.find((x) => x.id === m![1]); return i ? { ...i, timeline: timelineFor(i) } : null; }
  if (p === "/incidents") {
    let list = incidents;
    if (q.get("open") === "true") list = list.filter((i) => !["Resolved", "Closed", "Verified"].includes(i.status));
    if (q.get("severity")) list = list.filter((i) => q.get("severity")!.split(",").includes(i.severity));
    if (q.get("status")) list = list.filter((i) => q.get("status")!.split(",").includes(i.status));
    if (q.get("category")) list = list.filter((i) => i.category === q.get("category"));
    if (q.get("department")) list = list.filter((i) => i.department === q.get("department"));
    return list.slice(0, Number(q.get("limit") ?? 100));
  }
  if (p === "/sla/summary") return { open: { green: 9, amber: 3, red: 2 }, responseCompliancePct: 94.2, resolutionCompliancePct: 88.7, window: "30d" };
  if (p === "/sla/timers") {
    return (q.get("incidentIds") ?? "").split(",").filter(Boolean).map((id, n) => ({
      incidentId: id, response: n % 5 === 0 ? "red" : n % 3 === 0 ? "amber" : "met", resolution: n % 4 === 0 ? "amber" : "green",
      responseDue: iso(-600_000), resolutionDue: iso(-3 * 3600_000),
    }));
  }
  if (p === "/sla/policies") return { defaults: { Critical: { responseMin: 5, resolutionMin: 240 }, High: { responseMin: 15, resolutionMin: 480 }, Medium: { responseMin: 60, resolutionMin: 1440 }, Low: { responseMin: 240, resolutionMin: 4320 } }, overrides: [] };
  if (p === "/work-orders") {
    let list = workOrders;
    if (q.get("assignee") === "me") list = list.filter((w) => w.assignee === "tech.delhi");
    if (q.get("incidentId")) list = list.filter((w) => w.incidentId === q.get("incidentId"));
    return list;
  }
  if (p === "/tenants") return tenants;
  m = /^\/tenants\/([^/]+)\/api-keys$/.exec(p);
  if (m) return [{ id: uuid(), name: "Demo simulator key", prefix: "sk_delhi_dem", scopes: ["telemetry:write"], created_by: "seed", created_at: iso(86_400_000) }];
  m = /^\/tenants\/([^/]+)$/.exec(p);
  if (m) return tenants.find((t) => t.id === m![1]) ?? tenants[0];
  if (p === "/notifications") return incidents.slice(0, 6).map((i, n) => ({ id: n, channel: "email", recipient: "control-room@delhi.scaas.local", kind: "incident.created", subject: `[${i.severity}] ${i.ref} ${i.title}`, status: "sent", at: i.createdAt }));
  if (p === "/notifications/channels") return [{ id: uuid(), channel: "email", target: "control-room@delhi.scaas.local", events: ["incident.created", "sla.breached"], min_severity: "High", enabled: true }];
  if (p === "/audit") return incidents.slice(0, 15).map((i) => ({ tenant_id: "delhi", actor: "operator.delhi", action: "POST /api/incidents", resource: `/api/incidents/${i.id}/transition`, source: "api-gateway", data: { status: 200 }, at: i.updatedAt }));
  if (p === "/system/health") return SERVICES.map((s) => ({ service: s, status: "up", latencyMs: Math.round(3 + rnd() * 20) }));
  if (p === "/connectors") return { weather: { provider: "open-meteo", intervalMin: 10 }, events: { provider: "demo" }, traffic: { provider: "none" }, batch: { endpoint: "POST /api/connectors/batch" } };
  return null;
}

/** Demo-mode mutations, so buttons work in a disconnected demo. */
export function mockMutate(method: string, path: string, body: any): any {
  let m = /^\/incidents\/([^/]+)\/transition$/.exec(path);
  if (m) {
    const i = incidents.find((x) => x.id === m![1]);
    if (!i) return null;
    const to: Record<string, string> = { acknowledge: "Acknowledged", assign: "Assigned", start: "In Progress", resolve: "Resolved", verify: "Verified", close: "Closed", reopen: "Reopened" };
    if (body.action === "escalate") i.escalationLevel++;
    else i.status = to[body.action] ?? i.status;
    if (body.assignee) i.assignee = body.assignee;
    i.updatedAt = new Date().toISOString();
    return i;
  }
  if (method === "POST" && path === "/incidents") {
    const i = { id: uuid(), ref: `INC-${String(2000 + incidents.length).padStart(6, "0")}`, tenantId: "delhi", status: "New", source: "citizen", escalationLevel: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...body };
    incidents.unshift(i);
    return i;
  }
  m = /^\/work-orders\/([^/]+)\/transition$/.exec(path);
  if (m) {
    const w = workOrders.find((x) => x.id === m![1]);
    const to: Record<string, string> = { assign: "Assigned", accept: "Accepted", start: "In Progress", hold: "On Hold", resume: "In Progress", complete: "Completed", verify: "Verified", close: "Closed", cancel: "Cancelled", reject: "In Progress" };
    if (w) { w.status = to[body.action] ?? w.status; w.updatedAt = new Date().toISOString(); }
    return w;
  }
  if (method === "POST" && path === "/work-orders") {
    const w = { id: uuid(), ref: `WO-${String(400 + workOrders.length).padStart(6, "0")}`, status: body.assignee ? "Assigned" : "Open", createdAt: new Date().toISOString(), checklist: [], evidence: [], ...body };
    workOrders.unshift(w);
    return w;
  }
  if (method === "POST" && /\/api-keys$/.test(path)) return { id: uuid(), name: body?.name, key: `sk_delhi_${uuid().replace(/-/g, "")}`, note: "Demo key (not valid against a real backend)" };
  return { ok: true };
}

/** Simulated live events for demo mode. */
export function mockLiveEvent(): { event: string; data: Any } {
  const d = pick(devices);
  if (rnd() < 0.15) {
    const i = pick(incidents);
    return { event: "incident", data: { type: "incident.updated", entity: { type: "INCIDENT", id: i.id, name: i.ref }, occurredAt: new Date().toISOString(), data: { incident: i, action: "update" } } };
  }
  d.values = valuesFor(d.deviceType);
  d.ts = Date.now();
  return { event: "twin", data: { type: "observation.recorded", entity: { type: "DEVICE", id: d.deviceId }, occurredAt: new Date().toISOString(), data: { deviceId: d.deviceId, deviceType: d.deviceType, values: d.values, location: { lat: d.lat, lon: d.lon } } } };
}
