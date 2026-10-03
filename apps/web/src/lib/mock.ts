/**
 * Demo data used ONLY when the API gateway is unreachable (the UI shows a "Demo data" badge).
 * Shapes match the real service responses, so every screen can be built and demoed before the backend is up.
 * Mutations are applied in memory, so a full demo (onboard a device, run an incident to closure, create a city) works offline.
 */
type Any = Record<string, any>;

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const uuid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(rnd() * 16).toString(16));
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const now = () => new Date().toISOString();

/** Roles of the signed-in demo user (set by AuthProvider) so allowed actions match the persona. */
let mockRoles: string[] = ["operator"];
let mockUser = "operator.delhi";
export function setMockIdentity(roles: string[], user: string) { mockRoles = roles; mockUser = user; }

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
const DEPT: Record<string, string> = { traffic: "Traffic Police", parking: "Traffic Police", water: "Water Supply", electricity: "Electricity", waste: "Solid Waste", lighting: "Street Lighting", environment: "Environment", mobility: "Transport", emergency: "Disaster Management", weather: "Disaster Management" };

export const CATALOG: Any[] = [
  { name: "Street Light", prefix: "SL", domain: "lighting", description: "Smart LED street light with CCMS controller", telemetry: ["status", "brightness", "powerW", "energyKWh", "fault", "battery"], alarms: [{ type: "Lamp Fault", create: { MAJOR: { key: "fault", op: "EQUAL", value: true } } }, { type: "Low Backup Battery", create: { MINOR: { key: "battery", op: "LESS", value: 20 } } }] },
  { name: "Traffic Junction", prefix: "TJ", domain: "traffic", description: "ATCS junction controller with vehicle detection", telemetry: ["vehicleCount", "speedKmh", "queueLength", "signalPhase", "signalFault"], alarms: [{ type: "Congestion", create: { CRITICAL: { key: "speedKmh", op: "LESS", value: 8, minutes: 5 }, MAJOR: { key: "speedKmh", op: "LESS", value: 15, minutes: 5 } } }, { type: "Signal Fault", create: { CRITICAL: { key: "signalFault", op: "EQUAL", value: true } } }] },
  { name: "Air Quality Station", prefix: "AQ", domain: "environment", description: "Ambient air quality and noise station", telemetry: ["pm25", "pm10", "no2", "co2", "aqi", "noiseDb", "temperatureC", "humidity"], alarms: [{ type: "High PM2.5", create: { CRITICAL: { key: "pm25", op: "GREATER", value: 120 }, MAJOR: { key: "pm25", op: "GREATER", value: 60 } } }, { type: "Noise Limit Exceeded", create: { WARNING: { key: "noiseDb", op: "GREATER", value: 85, minutes: 10 } } }] },
  { name: "Water Node", prefix: "WN", domain: "water", description: "Pipeline pressure, flow and quality node", telemetry: ["flowLpm", "pressureBar", "turbidityNtu", "levelPct", "leak"], alarms: [{ type: "Low Water Pressure", create: { MAJOR: { key: "pressureBar", op: "LESS", value: 1.5, minutes: 2 } } }, { type: "Leak Suspected", create: { CRITICAL: { key: "leak", op: "EQUAL", value: true } } }, { type: "High Turbidity", create: { MINOR: { key: "turbidityNtu", op: "GREATER", value: 5 } } }] },
  { name: "Power Meter", prefix: "PM", domain: "electricity", description: "Substation / feeder smart meter", telemetry: ["voltage", "currentA", "loadKw", "loadPct", "powerFactor"], alarms: [{ type: "Feeder Overload", create: { CRITICAL: { key: "loadPct", op: "GREATER", value: 100 }, MAJOR: { key: "loadPct", op: "GREATER", value: 90 } } }, { type: "Power Outage", create: { CRITICAL: { key: "voltage", op: "LESS", value: 50 } } }] },
  { name: "Smart Bin", prefix: "WB", domain: "waste", description: "Ultrasonic fill-level bin sensor", telemetry: ["fillPct", "temperatureC", "battery"], alarms: [{ type: "Bin Almost Full", create: { MAJOR: { key: "fillPct", op: "GREATER", value: 85 } } }, { type: "Bin Fire Risk", create: { CRITICAL: { key: "temperatureC", op: "GREATER", value: 60 } } }] },
  { name: "Parking Sensor", prefix: "PK", domain: "parking", description: "In-ground parking bay occupancy sensor", telemetry: ["occupied", "dwellMin"], alarms: [{ type: "Overstay", create: { MINOR: { key: "dwellMin", op: "GREATER", value: 240 } } }] },
  { name: "Vehicle", prefix: "VH", domain: "mobility", description: "Municipal fleet vehicle tracker", telemetry: ["speedKmh", "heading", "battery", "fuelPct"], alarms: [] },
  { name: "Drone", prefix: "DR", domain: "mobility", description: "Inspection drone telemetry", telemetry: ["altitudeM", "speedKmh", "battery", "heading"], alarms: [{ type: "Low Battery", create: { MAJOR: { key: "battery", op: "LESS", value: 25 } } }] },
  { name: "Air Taxi", prefix: "AT", domain: "mobility", description: "eVTOL air taxi position", telemetry: ["altitudeM", "speedKmh", "battery", "passengers"], alarms: [] },
  { name: "Emergency Unit", prefix: "ER", domain: "emergency", description: "Ambulance / fire unit availability", telemetry: ["available", "speedKmh", "assignment"], alarms: [] },
  { name: "Weather Feed", prefix: "WX", domain: "weather", description: "City weather (Open-Meteo connector)", telemetry: ["temperatureC", "humidity", "rainMm", "windKmh", "weatherCode"], alarms: [{ type: "Heavy Rain", create: { MAJOR: { key: "rainMm", op: "GREATER", value: 20 } } }] },
  { name: "City Event Feed", prefix: "EV", domain: "events", description: "Planned public events (crowd, closures)", telemetry: ["expectedCrowd", "roadClosure"], alarms: [] },
  { name: "Generic Sensor", prefix: "GS", domain: "generic", description: "Any other sensor; map its keys with a profile", telemetry: ["value"], alarms: [] },
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
const DOMAIN_OF = Object.fromEntries(CATALOG.map((c) => [c.name, c.domain]));

// ---------------------------------------------------------------- twin devices
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
const movers: Any[] = [];
for (const [prefix, type, n] of [["DR", "Drone", 3], ["AT", "Air Taxi", 2], ["ER", "Emergency Unit", 3], ["VH", "Vehicle", 4]] as Array<[string, string, number]>) {
  for (let i = 1; i <= n; i++) {
    const d = { deviceId: `${prefix}-DEL-0${i}`, deviceType: type, domain: DOMAIN_OF[type], zone: pick(ZONES).name,
      lat: CENTER.lat + (rnd() - 0.5) * 0.12, lon: CENTER.lon + (rnd() - 0.5) * 0.14, ts: Date.now(), values: valuesFor(type), online: true, alarms: [],
      orbit: { r: 0.02 + rnd() * 0.04, phase: rnd() * 6.28, speed: prefix === "VH" ? 0.04 : 0.12 } };
    devices.push(d); movers.push(d);
  }
}
devices.push({ deviceId: "WX-delhi", deviceType: "Weather Feed", domain: "weather", zone: "Connaught Place", lat: CENTER.lat, lon: CENTER.lon, ts: Date.now(),
  values: { temperatureC: 28, humidity: 62, rainMm: 0, windKmh: 9, weatherCode: 1 }, online: true, alarms: [] });
// a few offline devices
for (const d of devices.filter((x) => x.deviceType === "Smart Bin").slice(0, 3)) { d.online = false; d.ts = Date.now() - 3 * 3600_000; }

// ---------------------------------------------------------------- device registry (asset-service)
const SITE_WORD: Record<string, [string, string]> = { "Street Light": ["Street Grid", "street"], "Traffic Junction": ["Junction", "junction"], "Air Quality Station": ["AQ Station", "station"], "Water Node": ["Water Network", "pipeline"], "Power Meter": ["Substation", "substation"], "Smart Bin": ["Ward Bins", "ward"], "Parking Sensor": ["Parking Zone", "parking"], Vehicle: ["City Fleet Depot", "depot"], Drone: ["Drone Port", "depot"], "Air Taxi": ["Vertiport", "depot"], "Emergency Unit": ["Emergency Base", "depot"], "Weather Feed": ["City Weather Station", "station"] };
const ASSET_WORD: Record<string, string> = { "Street Light": "Pole", "Traffic Junction": "Signal head", "Air Quality Station": "AQ mast", "Water Node": "Main", "Power Meter": "Feeder", "Smart Bin": "Bin", "Parking Sensor": "Bay", Vehicle: "Vehicle", Drone: "Drone", "Air Taxi": "Air taxi", "Emergency Unit": "Unit", "Weather Feed": "Weather mast" };
const VENDOR: Record<string, string> = { "Street Light": "Signify", "Traffic Junction": "Siemens Mobility", "Air Quality Station": "Aeroqual", "Water Node": "Siemens", "Power Meter": "Schneider", "Smart Bin": "Sensoneo", "Parking Sensor": "Nedap", Vehicle: "Tata", Drone: "ideaForge", "Air Taxi": "ePlane", "Emergency Unit": "Force", "Weather Feed": "Davis" };

export const sites: Any[] = [];
export const assets: Any[] = [];
export const registry: Any[] = [];
const siteByName = new Map<string, Any>();
devices.forEach((d, i) => {
  const cityWide = ["mobility", "emergency", "weather"].includes(d.domain);
  const [word, kind] = SITE_WORD[d.deviceType] ?? ["Site", "site"];
  const siteName = cityWide ? word : d.deviceType === "Traffic Junction" ? `${d.zone} ${word} ${d.deviceId.slice(-2)}` : `${d.zone} ${word}`;
  let site = siteByName.get(siteName);
  if (!site) { site = { id: uuid(), code: siteName.toLowerCase().replace(/\W+/g, "-"), name: siteName, zone: cityWide ? undefined : d.zone, kind, lat: d.lat, lon: d.lon }; siteByName.set(siteName, site); sites.push(site); }
  const asset = { id: uuid(), siteId: site.id, siteName: site.name, code: d.deviceId.toLowerCase(), name: `${ASSET_WORD[d.deviceType] ?? "Asset"} ${d.deviceId}`, kind: (ASSET_WORD[d.deviceType] ?? "asset").toLowerCase(), department: DEPT[d.domain] ?? "Operations", criticality: ["Traffic Junction", "Water Node"].includes(d.deviceType) ? "High" : d.deviceType === "Power Meter" ? "Critical" : "Medium" };
  assets.push(asset);
  registry.push({
    deviceId: d.deviceId, name: `${d.deviceType} ${d.deviceId}`, deviceType: d.deviceType, domain: d.domain, status: "Active",
    serial: `SN-DEL-${10000 + i}`, vendor: VENDOR[d.deviceType], model: `${d.deviceId.slice(0, 2)}-${2024 + (i % 3)}`, firmware: `${1 + (i % 3)}.${i % 10}.${i % 7}`,
    protocol: i % 5 === 0 ? "mqtt" : "http-ingest", zone: cityWide ? "Connaught Place" : d.zone, siteId: site.id, siteName: site.name, assetId: asset.id, assetName: asset.name,
    department: asset.department, criticality: asset.criticality, lat: d.lat, lon: d.lon, tbDeviceId: uuid(),
    firstSeen: iso(40 * 86_400_000), lastSeen: new Date(d.ts).toISOString(), online: d.online !== false, installedAt: iso((30 + (i % 600)) * 86_400_000).slice(0, 10), createdBy: "seed", createdAt: iso(60 * 86_400_000), updatedAt: iso(rnd() * 86_400_000),
  });
});
const reg = (id: string) => registry.find((r) => r.deviceId === id);
for (const [id, st] of [[registry[4].deviceId, "Maintenance"], [registry[17].deviceId, "Faulty"], [registry[31].deviceId, "Maintenance"]] as Array<[string, string]>) reg(id)!.status = st;
registry.push(
  { deviceId: "SL-CP-NEW-01", name: "New lamp, CP outer circle", deviceType: "Street Light", domain: "lighting", status: "Provisioned", protocol: "mqtt", zone: "Connaught Place", siteId: sites[0].id, siteName: sites[0].name, department: "Street Lighting", criticality: "Medium", lat: 28.6331, lon: 77.2195, vendor: "Signify", serial: "SN-NEW-0001", online: false, createdBy: "admin.delhi", createdAt: iso(3600_000), updatedAt: iso(3600_000), tbDeviceId: uuid() },
  { deviceId: "WN-SKT-NEW-09", name: "Saket booster main", deviceType: "Water Node", domain: "water", status: "Registered", protocol: "http-ingest", zone: "Saket", department: "Water Supply", criticality: "High", lat: 28.527, lon: 77.209, vendor: "Siemens", online: false, createdBy: "admin.delhi", createdAt: iso(7200_000), updatedAt: iso(7200_000) },
  { deviceId: "ACME-AQ-901", deviceType: "Air Quality Station", domain: "environment", status: "Discovered", protocol: "http-ingest", zone: "Connaught Place", lat: 28.6355, lon: 77.2137, online: true, firstSeen: iso(900_000), lastSeen: iso(10_000), createdBy: "discovery", createdAt: iso(900_000), updatedAt: iso(10_000), discoveredKeys: ["pm2_5_ugm3", "pm10_ugm3", "no2_ppb", "temp_f", "rssi"] },
  { deviceId: "ACME-AQ-902", deviceType: "Air Quality Station", domain: "environment", status: "Discovered", protocol: "http-ingest", zone: "Connaught Place", lat: 28.6395, lon: 77.2107, online: true, firstSeen: iso(880_000), lastSeen: iso(12_000), createdBy: "discovery", createdAt: iso(880_000), updatedAt: iso(12_000), discoveredKeys: ["pm2_5_ugm3", "pm10_ugm3", "no2_ppb", "temp_f", "rssi"] },
);
export const mappingProfiles: Any[] = [{ id: uuid(), name: "Acme AirSense v2", vendor: "Acme", deviceType: "Air Quality Station", devices: 0, createdAt: iso(10 * 86_400_000),
  rules: [{ from: "pm2_5_ugm3", to: "pm25" }, { from: "pm10_ugm3", to: "pm10" }, { from: "no2_ppb", to: "no2", scale: 1.88 }, { from: "temp_f", to: "temperatureC", scale: 0.5556, offset: -17.778 }, { from: "rssi", to: "", drop: true }] }];
const deviceEvents: Record<string, Any[]> = {};
const devEvent = (id: string, type: string, data: Any = {}) => { (deviceEvents[id] ??= []).unshift({ type, actor: mockUser, data, at: now() }); };

// ---------------------------------------------------------------- incidents (lifecycle v2)
const CATS = ["traffic", "water", "electricity", "waste", "lighting", "environment"];
const TITLES: Record<string, string[]> = {
  traffic: ["Congestion at", "Signal Fault at"], water: ["Low Water Pressure at", "Leak Suspected at"], electricity: ["Feeder Overload at", "Power Outage at"],
  waste: ["Bin Almost Full at", "Bin Fire Risk at"], lighting: ["Lamp Fault at"], environment: ["High PM2.5 at"],
};
const STATUS_POOL = ["New", "New", "New", "Acknowledged", "Assigned", "In Progress", "In Progress", "Escalated", "Resolution Pending", "Resolved", "Closed"];
const RULES: Record<string, [string[], string?]> = {
  acknowledge: [["New"], "Acknowledged"], assign: [["New", "Acknowledged", "Assigned", "In Progress", "Escalated"], "Assigned"], start: [["Acknowledged", "Assigned", "Escalated"], "In Progress"],
  escalate: [["New", "Acknowledged", "Assigned", "In Progress", "Escalated"]], complete: [["Assigned", "In Progress", "Escalated"], "Resolution Pending"],
  resolve: [["Acknowledged", "Assigned", "In Progress", "Escalated", "Resolution Pending"], "Resolved"], confirm: [["Resolution Pending"], "Resolved"],
  reopen: [["Resolution Pending", "Resolved"], "In Progress"], close: [["Resolved"], "Closed"], dismiss: [["New", "Acknowledged"], "Closed"],
};
const ACTION_ROLES: Record<string, string[]> = {
  acknowledge: ["operator", "dept_head", "city_admin"], assign: ["operator", "dept_head", "city_admin"], start: ["operator", "dept_head", "field_tech"],
  escalate: ["operator", "dept_head", "city_admin"], complete: ["field_tech", "dept_head", "operator", "city_admin"], resolve: ["operator", "dept_head", "city_admin"],
  confirm: ["operator", "dept_head", "city_admin", "citizen"], reopen: ["operator", "dept_head", "city_admin", "citizen"], close: ["operator", "dept_head", "city_admin"], dismiss: ["operator", "dept_head", "city_admin"],
};
const OPEN = ["New", "Acknowledged", "Assigned", "In Progress", "Escalated", "Resolution Pending"];
function allowed(status: string, roles = mockRoles) {
  return Object.keys(RULES).filter((a) => RULES[a][0].includes(status) && (roles.includes("super_admin") || ACTION_ROLES[a].some((r) => roles.includes(r))))
    .filter((a) => !(roles.length === 1 && roles[0] === "citizen") || ["confirm", "reopen"].includes(a));
}

export const incidents: Any[] = Array.from({ length: 30 }, (_, i) => {
  const category = pick(CATS);
  const d = pick(devices.filter((x) => x.domain === category)) ?? devices[0];
  const r = reg(d.deviceId);
  const severity = pick(["Critical", "High", "High", "Medium", "Medium", "Low"]);
  const age = rnd() * 6 * 3600_000;
  const status = pick(STATUS_POOL);
  const source = i % 9 === 4 ? "correlation" : i % 7 === 3 ? "citizen" : "alarm";
  return {
    id: uuid(), ref: `INC-${String(1040 + i).padStart(6, "0")}`, tenantId: "delhi",
    title: source === "correlation" ? "Congestion risk: heavy rain + peak traffic" : source === "citizen" ? pick(["Street light not working", "Overflowing garbage bin", "Water leaking on road", "Pothole near market"]) : `${pick(TITLES[category])} ${d.deviceId}`,
    description: source === "correlation" ? "Correlated: rainMm 24 at WX-delhi; speedKmh 9 at TJ junctions in 2 zones" : source === "citizen" ? "Reported by a resident via the citizen portal." : "Raised automatically by ThingsBoard alarm rule.",
    category, severity, status, source, deviceId: source === "citizen" ? undefined : d.deviceId, deviceType: d.deviceType, zone: d.zone, lat: d.lat, lon: d.lon,
    department: DEPT[category], site: r?.siteName, asset: r?.assetName, reporter: source === "citizen" ? "dev-citizen.delhi" : undefined,
    assignee: ["Assigned", "In Progress", "Escalated", "Resolution Pending"].includes(status) ? "tech.delhi" : undefined, escalationLevel: status === "Escalated" ? 1 : rnd() > 0.9 ? 1 : 0,
    createdAt: iso(age), updatedAt: iso(age / 2), acknowledgedAt: status !== "New" ? iso(age - 120_000) : undefined, photos: [],
  };
}).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
// older history for replay / trend
for (let i = 0; i < 24; i++) {
  const d = pick(devices.filter((x) => x.domain !== "mobility"));
  incidents.push({ id: uuid(), ref: `INC-${String(900 + i).padStart(6, "0")}`, tenantId: "delhi", title: `${pick(Object.values(TITLES).flat())} ${d.deviceId}`, category: d.domain, severity: pick(["High", "Medium", "Low"]),
    status: "Closed", source: "alarm", deviceId: d.deviceId, zone: d.zone, lat: d.lat, lon: d.lon, department: DEPT[d.domain] ?? "Operations", escalationLevel: 0,
    createdAt: iso(7 * 3600_000 + i * 2400_000), updatedAt: iso(6 * 3600_000), resolvedAt: iso(6 * 3600_000), closedAt: iso(5 * 3600_000), photos: [] });
}

export const workOrders: Any[] = incidents.filter((i) => ["Assigned", "In Progress", "Escalated", "Resolution Pending", "Resolved", "Closed"].includes(i.status)).slice(0, 12).map((i, n) => ({
  id: uuid(), ref: `WO-${String(300 + n).padStart(6, "0")}`, incidentId: i.id, title: `Fix: ${i.title}`, status: pick(["Assigned", "Accepted", "In Progress", "In Progress", "On Hold", "Completed", "Verified"]),
  priority: i.severity, department: i.department, assignee: "tech.delhi", dueAt: iso(-4 * 3600_000 + n * 1800_000), checklist: [{ item: "Inspect asset", done: true }, { item: "Isolate and make safe", done: n % 2 === 0 }, { item: "Repair / replace", done: false }],
  evidence: [], createdBy: "operator.delhi", createdAt: i.createdAt, updatedAt: i.updatedAt, deviceId: i.deviceId, zone: i.zone, lat: i.lat, lon: i.lon,
}));

const timelines: Record<string, Any[]> = {};
function timelineFor(i: Any) {
  if (timelines[i.id]) return timelines[i.id];
  const t: Any[] = [{ type: "created", actor: i.source === "citizen" ? "citizen.delhi" : i.source === "correlation" ? "correlation" : "thingsboard", data: { source: i.source }, at: i.createdAt }];
  if (i.acknowledgedAt) t.push({ type: "status.changed", actor: "operator.delhi", data: { from: "New", to: "Acknowledged", action: "acknowledge" }, at: i.acknowledgedAt });
  if (i.assignee) t.push({ type: "status.changed", actor: "operator.delhi", data: { from: "Acknowledged", to: "Assigned", action: "assign", assignee: i.assignee }, at: iso((Date.now() - new Date(i.createdAt).getTime()) * 0.6) });
  if (["In Progress", "Escalated", "Resolution Pending", "Resolved", "Closed"].includes(i.status)) t.push({ type: "status.changed", actor: "tech.delhi", data: { from: "Assigned", to: "In Progress", action: "start" }, at: iso((Date.now() - new Date(i.createdAt).getTime()) * 0.4) });
  if (i.status === "Escalated") t.push({ type: "escalated", actor: "SLA engine", data: { from: "In Progress", to: "Escalated", action: "escalate", note: "resolution SLA breached; escalated to dept_head" }, at: iso(600_000) });
  timelines[i.id] = t;
  return t;
}

// ---------------------------------------------------------------- city, platform, admin
const tenants: Any[] = [
  { id: "delhi", name: "New Delhi Municipal Council", cityName: "New Delhi", center: CENTER, zones: ZONES, branding: { productName: "Smart City Operating System", logoText: "NDMC" }, status: "active", plan: "enterprise", modules: ["command_centre", "digital_twin", "sla_workorders", "citizen_portal", "analytics", "integrations"], quotas: {}, effectiveQuotas: { devices: 50000, users: 2000, apiCallsPerDay: 20000000, retentionDays: 365 }, population: 2400000, contact: { name: "IT Cell NDMC", email: "it@ndmc.example" }, createdAt: iso(40 * 86_400_000), provisionLog: [{ at: iso(40 * 86_400_000), step: "City is active", ok: true }] },
  { id: "bengaluru", name: "Bruhat Bengaluru Mahanagara Palike", cityName: "Bengaluru", center: { lat: 12.9716, lon: 77.5946 }, zones: [{ name: "MG Road", lat: 12.9756, lon: 77.6067 }, { name: "Koramangala", lat: 12.9352, lon: 77.6245 }, { name: "Whitefield", lat: 12.9698, lon: 77.75 }, { name: "Electronic City", lat: 12.8452, lon: 77.6602 }], branding: {}, status: "active", plan: "standard", modules: ["command_centre", "digital_twin", "sla_workorders", "citizen_portal", "analytics"], quotas: {}, effectiveQuotas: { devices: 5000, users: 150, apiCallsPerDay: 2000000, retentionDays: 90 }, population: 8400000, contact: {}, createdAt: iso(32 * 86_400_000), provisionLog: [{ at: iso(32 * 86_400_000), step: "City is active", ok: true }] },
  { id: "pune", name: "Pune Municipal Corporation", cityName: "Pune", center: { lat: 18.5204, lon: 73.8567 }, zones: [{ name: "Shivajinagar", lat: 18.5308, lon: 73.8475 }, { name: "Hinjewadi", lat: 18.5912, lon: 73.7389 }], branding: {}, status: "suspended", plan: "starter", modules: ["command_centre", "digital_twin", "citizen_portal"], quotas: {}, effectiveQuotas: { devices: 500, users: 25, apiCallsPerDay: 100000, retentionDays: 30 }, population: 3100000, contact: {}, createdAt: iso(12 * 86_400_000), provisionLog: [{ at: iso(12 * 86_400_000), step: "City is active", ok: true }] },
];
const PLANS = {
  plans: {
    starter: { name: "Starter", priceNote: "Pilot / single department", quotas: { devices: 500, users: 25, apiCallsPerDay: 100000, retentionDays: 30 }, modules: ["command_centre", "digital_twin", "citizen_portal"] },
    standard: { name: "Standard", priceNote: "City-wide operations", quotas: { devices: 5000, users: 150, apiCallsPerDay: 2000000, retentionDays: 90 }, modules: ["command_centre", "digital_twin", "sla_workorders", "citizen_portal", "analytics"] },
    enterprise: { name: "Enterprise", priceNote: "Metro scale, all modules", quotas: { devices: 50000, users: 2000, apiCallsPerDay: 20000000, retentionDays: 365 }, modules: ["command_centre", "digital_twin", "sla_workorders", "citizen_portal", "analytics", "integrations"] },
  },
  modules: [{ id: "command_centre", name: "Command Centre" }, { id: "digital_twin", name: "Digital Twin" }, { id: "sla_workorders", name: "SLA & Work Orders" }, { id: "citizen_portal", name: "Citizen Portal" }, { id: "analytics", name: "Analytics & Reports" }, { id: "integrations", name: "Integrations & API" }],
};
export const departments: Any[] = [
  { id: "traffic", name: "Traffic Police", head: "traffic.head", email: "traffic@delhi.scaas.local", categories: ["traffic", "parking"] },
  { id: "water", name: "Water Supply", head: "waterhead.delhi", email: "water@delhi.scaas.local", categories: ["water"] },
  { id: "electricity", name: "Electricity", head: "power.head", email: "power@delhi.scaas.local", categories: ["electricity"] },
  { id: "lighting", name: "Street Lighting", head: "lighting.head", email: "lighting@delhi.scaas.local", categories: ["lighting"] },
  { id: "waste", name: "Solid Waste", head: "waste.head", email: "waste@delhi.scaas.local", categories: ["waste"] },
  { id: "environment", name: "Environment", head: "env.head", email: "environment@delhi.scaas.local", categories: ["environment"] },
  { id: "transport", name: "Transport", head: "transport.head", email: "transport@delhi.scaas.local", categories: ["mobility"] },
  { id: "disaster", name: "Disaster Management", head: "dm.head", email: "dm@delhi.scaas.local", categories: ["weather", "events", "emergency"] },
];
export const users: Any[] = [
  ["admin.delhi", "Delhi", "Admin", "city_admin"], ["mayor.delhi", "Delhi", "Commissioner", "leadership"], ["operator.delhi", "Delhi", "Operator", "operator"],
  ["waterhead.delhi", "Water", "Head", "dept_head", "water"], ["tech.delhi", "Field", "Technician", "field_tech", "water"], ["analyst.delhi", "City", "Analyst", "analyst"],
  ["itops.delhi", "IT", "Ops", "it_ops"], ["citizen.delhi", "Delhi", "Resident", "citizen"], ["operator2.delhi", "Night", "Operator", "operator"],
].map(([username, firstName, lastName, role, department]) => ({ id: uuid(), username, firstName, lastName, email: `${username}@scaas.local`, enabled: true, roles: [role], department, createdAt: Date.now() - rnd() * 40 * 86_400_000 }));
export const announcements: Any[] = [{ id: uuid(), tenantId: "*", title: "Platform maintenance Sunday 02:00-03:00 IST", body: "ThingsBoard upgrade to 4.4.1. Live data is buffered in Kafka; nothing is lost.", level: "info", startsAt: iso(3600_000), createdBy: "superadmin" }];
export const advisories: Any[] = [
  { id: uuid(), title: "Water supply maintenance in Karol Bagh", body: "Supply will be reduced 10:00-14:00 while the main is repaired. Tankers are stationed at the market.", category: "water", level: "warning", zone: "Karol Bagh", lat: 28.6514, lon: 77.1907, startsAt: iso(2 * 3600_000), endsAt: iso(-4 * 3600_000), publishedBy: "operator.delhi", active: true },
  { id: uuid(), title: "Diversion at Saket metro junction", body: "Signal repair in progress; use Press Enclave Road.", category: "traffic", level: "info", zone: "Saket", lat: 28.5245, lon: 77.2066, startsAt: iso(3600_000), publishedBy: "operator.delhi", active: true },
];
export const shiftLog: Any[] = [{ id: 1, author: "operator2.delhi", shift: "Night", note: "Quiet night. Feeder PM-SAKET-01 ran at 92% from 20:00-22:00; Electricity informed. Karol Bagh main repair continues today.", openItems: ["Confirm KB main repair by 14:00", "Watch Saket feeder load at evening peak"], at: iso(9 * 3600_000) }];
let preferences: Any = { email: "resident@example.com", channels: ["email"], categories: [], zones: ["Connaught Place"], advisories: true };
const apiKeys: Any[] = [{ id: uuid(), name: "Demo simulator key", prefix: "sk_delhi_dem", scopes: ["telemetry:write"], created_by: "seed", created_at: iso(86_400_000) }];
const channels: Any[] = [
  { id: uuid(), channel: "email", target: "control-room@delhi.scaas.local", events: ["incident.created", "incident.escalated", "sla.breached"], min_severity: "High", enabled: true },
  { id: uuid(), channel: "email", target: "$assignee", events: ["workorder.assigned"], min_severity: "Low", enabled: true },
  { id: uuid(), channel: "sms", target: "+910000000000", events: ["sla.breached"], min_severity: "Critical", enabled: true },
  { id: uuid(), channel: "webhook", target: "https://teams.example/hook/ops", events: ["incident.escalated"], min_severity: "High", enabled: false },
];
const slaOverrides: Any[] = [{ category: "water", severity: "Critical", response_min: 5, resolution_min: 180, amber_pct: 70, escalate_to: "dept_head,city_admin", auto_escalate: true }];

// ---------------------------------------------------------------- derived views
function summary() {
  const byDomain = new Map<string, { total: number; healthy: number; offline: number; alarmed: number }>();
  const open = incidents.filter((i) => OPEN.includes(i.status));
  for (const d of devices) {
    const s = byDomain.get(d.domain) ?? { total: 0, healthy: 0, offline: 0, alarmed: 0 };
    s.total++;
    const bad = open.some((i) => i.deviceId === d.deviceId && ["Critical", "High"].includes(i.severity));
    if (bad) s.alarmed++; else s.healthy++;
    if (d.online === false) s.offline++;
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

function group(list: Any[], k: string) {
  return Object.entries(list.reduce((m: Any, i) => ((m[i[k] ?? "Unassigned"] = (m[i[k] ?? "Unassigned"] ?? 0) + 1), m), {}))
    .map(([key, count]) => ({ key, count })).sort((a: Any, b: Any) => b.count - a.count);
}
function stats(dept?: string) {
  const scoped = dept ? incidents.filter((i) => i.department === dept) : incidents;
  const open = scoped.filter((i) => OPEN.includes(i.status));
  return {
    total: scoped.length, open: open.length, createdToday: scoped.filter((i) => Date.now() - new Date(i.createdAt).getTime() < 86_400_000).length,
    escalated: open.filter((i) => i.status === "Escalated" || i.escalationLevel > 0).length, unacknowledged: open.filter((i) => i.status === "New").length,
    citizenOpen: open.filter((i) => i.source === "citizen").length, mttaMinutes: 6, mttrMinutes: 96,
    bySeverity: group(open, "severity"), byStatus: group(open, "status"), byCategory: group(open, "category"), byZone: group(open, "zone"),
    byDepartment: group(open, "department"), bySource: group(open, "source"), byAssignee: group(open, "assignee"),
  };
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
const timerFor = (i: Any, n: number) => {
  const created = new Date(i.createdAt).getTime();
  const sev: Any = { Critical: [5, 240], High: [15, 480], Medium: [60, 1440], Low: [240, 4320] };
  const [r, s] = sev[i.severity] ?? sev.Medium;
  const responseDue = new Date(created + r * 60_000).toISOString(), resolutionDue = new Date(created + s * 60_000).toISOString();
  const responseMet = i.status !== "New", resolutionMet = ["Closed"].includes(i.status);
  const ragOf = (due: string, met: boolean, metAt?: string) => met ? (metAt && metAt > due ? "met_late" : "met") : Date.now() > new Date(due).getTime() ? "red" : Date.now() > created + (new Date(due).getTime() - created) * 0.75 ? "amber" : "green";
  return { incidentId: i.id, responseDue, resolutionDue, responseMet, resolutionMet, response: ragOf(responseDue, responseMet, i.acknowledgedAt), resolution: ragOf(resolutionDue, resolutionMet, i.closedAt), escalateTo: n % 2 ? "dept_head" : undefined };
};
function hierarchy() {
  const live = registry.filter((d) => d.status !== "Decommissioned");
  const brief = (d: Any) => ({ deviceId: d.deviceId, name: d.name, deviceType: d.deviceType, status: d.status, online: d.online, domain: d.domain });
  const zones = [...new Set([...ZONES.map((z) => z.name), ...live.map((d) => d.zone).filter(Boolean)])].map((zone) => ({
    zone,
    sites: sites.filter((s) => s.zone === zone).map((s) => ({ ...s, assets: assets.filter((a) => a.siteId === s.id).map((a) => ({ ...a, devices: live.filter((d) => d.assetId === a.id).map(brief) })), devices: live.filter((d) => d.siteId === s.id && !d.assetId).map(brief) })),
    devices: live.filter((d) => d.zone === zone && !d.siteId).map(brief),
  }));
  return { zones, unplaced: live.filter((d) => !d.zone && !d.siteId).map(brief), citywide: sites.filter((s) => !s.zone).map((s) => ({ ...s, assets: assets.filter((a) => a.siteId === s.id).map((a) => ({ ...a, devices: live.filter((d) => d.assetId === a.id).map(brief) })) })) };
}
function assetSummary() {
  const live = registry.filter((d) => !["Discovered", "Decommissioned"].includes(d.status));
  const offline = live.filter((d) => !d.online).length;
  return { total: registry.length, registered: live.length, offline, online: live.length - offline, discovered: registry.filter((d) => d.status === "Discovered").length,
    sites: sites.length, assets: assets.length, mappingProfiles: mappingProfiles.length, quota: 50000,
    byStatus: group(registry, "status"), byType: group(registry, "deviceType"), byZone: group(registry, "zone"), byDepartment: group(registry, "department") };
}
function platformUsage() {
  const rows = tenants.map((t) => {
    const devs = t.id === "delhi" ? registry.length : t.id === "bengaluru" ? 102 : 18;
    const open = t.id === "delhi" ? incidents.filter((i) => OPEN.includes(i.status)).length : t.id === "bengaluru" ? 11 : 0;
    return { ...t, quotas: t.effectiveQuotas, zones: t.zones.length, devices: devs, activeDevices: Math.round(devs * 0.94), offlineDevices: Math.round(devs * 0.03), discoveredDevices: t.id === "delhi" ? 2 : 0,
      openIncidents: open, criticalIncidents: Math.round(open / 5), incidents24h: open + 4, deviceQuotaPct: Math.round((devs / t.effectiveQuotas.devices) * 1000) / 10 } as Any;
  });
  const sum = (k: string) => rows.reduce((n, r: Any) => n + (r[k] ?? 0), 0);
  return { generatedAt: now(), cities: rows, totals: { cities: rows.length, active: rows.filter((r) => r.status === "active").length, suspended: rows.filter((r) => r.status === "suspended").length, failed: 0, devices: sum("devices"), activeDevices: sum("activeDevices"), openIncidents: sum("openIncidents"), incidents24h: sum("incidents24h"), population: sum("population") } };
}

const SERVICES = ["api-gateway", "tenant-service", "ingest-service", "normalizer-service", "tb-bridge-service", "asset-service", "incident-service", "sla-workorder-service", "correlation-service", "notification-service", "audit-service", "connector-service"];
const auditLog: Any[] = incidents.slice(0, 18).map((i, n) => ({ tenant_id: n % 5 === 0 ? "bengaluru" : "delhi", actor: pick(["operator.delhi", "admin.delhi", "tech.delhi", "superadmin"]), action: pick(["incident.acknowledge", "incident.assign", "device.registered", "workorder.complete", "sla.policies.updated", "tenant.updated"]), resource: `incident/${i.id}`, source: "api-gateway", data: {}, at: i.updatedAt }));

/** Route a GET path to demo data. */
export function mockGet(path: string): any {
  const [p, qs] = path.split("?");
  const q = new URLSearchParams(qs ?? "");
  if (p === "/me") return null;
  if (p === "/overview") {
    return {
      generatedAt: now(), tenant: tenants[0], twin: summary(), incidents: stats(),
      sla: { open: { green: 9, amber: 3, red: 2 }, responseCompliancePct: 94.2, resolutionCompliancePct: 88.7, window: "30d" },
      recentAlerts: incidents.filter((i) => OPEN.includes(i.status)).slice(0, 8), weather: devices.find((d) => d.deviceType === "Weather Feed")?.values,
      assets: assetSummary(), advisories: advisories.filter((a) => a.active),
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
    const r = reg(decodeURIComponent(m[1]));
    return { state: d, profile: d?.deviceType, attributes: [{ key: "installDate", value: r?.installedAt ?? "2025-11-04" }, { key: "vendor", value: r?.vendor ?? "Acme IoT" }, { key: "site", value: r?.siteName }], activeAlarms: [] };
  }
  // assets / registry
  if (p === "/assets/catalog") return CATALOG;
  if (p === "/assets/summary") return assetSummary();
  if (p === "/assets/hierarchy") return hierarchy();
  if (p === "/assets/sites") return sites.filter((s) => !q.get("zone") || s.zone === q.get("zone")).map((s) => ({ ...s, assets: assets.filter((a) => a.siteId === s.id).length, devices: registry.filter((d) => d.siteId === s.id).length }));
  if (p === "/assets/assets") return assets.filter((a) => !q.get("siteId") || a.siteId === q.get("siteId"));
  if (p === "/assets/mapping-profiles") return mappingProfiles.map((mp) => ({ ...mp, devices: registry.filter((d) => d.profileId === mp.id).length }));
  if (p === "/assets/import-template") return "deviceId,name,deviceType,serial,vendor,model,firmware,protocol,zone,site,asset,department,criticality,lat,lon\nSL-CP-101,CP Lamp 101,Street Light,SN-0001,Signify,CityTouch,2.4.1,mqtt,Connaught Place,CP Inner Circle,Pole CP-101,Street Lighting,Medium,28.6318,77.2169";
  if (p === "/assets/devices") {
    let list = registry;
    const st = q.get("status");
    if (st) list = list.filter((d) => st.split(",").includes(d.status)); else list = list.filter((d) => d.status !== "Decommissioned");
    if (q.get("type")) list = list.filter((d) => d.deviceType === q.get("type"));
    if (q.get("zone")) list = list.filter((d) => d.zone === q.get("zone"));
    if (q.get("department")) list = list.filter((d) => d.department === q.get("department"));
    if (q.get("offline") === "true") list = list.filter((d) => !d.online && !["Discovered", "Decommissioned"].includes(d.status));
    const s = q.get("q")?.toLowerCase();
    if (s) list = list.filter((d) => `${d.deviceId} ${d.name ?? ""} ${d.serial ?? ""}`.toLowerCase().includes(s));
    return [...list].sort((a, b) => (a.status === "Discovered" ? -1 : 0) - (b.status === "Discovered" ? -1 : 0));
  }
  m = /^\/assets\/devices\/([^/]+)\/connection$/.exec(p);
  if (m) return connection(decodeURIComponent(m[1]));
  m = /^\/assets\/devices\/([^/]+)$/.exec(p);
  if (m) {
    const r = reg(decodeURIComponent(m[1]));
    if (!r) return null;
    const t = CATALOG.find((c) => c.name === r.deviceType);
    return { ...r, telemetryKeys: t?.telemetry ?? [], alarmRules: t?.alarms ?? [], profileName: mappingProfiles.find((x) => x.id === r.profileId)?.name,
      events: [...(deviceEvents[r.deviceId] ?? []), { type: r.status === "Discovered" ? "discovered" : "registered", actor: r.createdBy, data: r.discoveredKeys ? { keys: r.discoveredKeys } : {}, at: r.createdAt }] };
  }
  // incidents
  if (p === "/incidents/stats") return stats(q.get("department") ?? undefined);
  if (p === "/incidents/trend") return trend(Number(q.get("days") ?? 30));
  if (p === "/incidents/departments") {
    return departments.map((d) => { const l = incidents.filter((i) => i.department === d.name); return { department: d.name, total: l.length, open: l.filter((i) => OPEN.includes(i.status)).length, resolved: l.filter((i) => ["Resolved", "Closed"].includes(i.status)).length, escalated: l.filter((i) => i.status === "Escalated" || i.escalationLevel > 0).length, mttr_minutes: 60 + Math.round(rnd() * 120) }; }).filter((d) => d.total);
  }
  m = /^\/incidents\/([^/]+)$/.exec(p);
  if (m) { const i = incidents.find((x) => x.id === m![1]); return i ? { ...i, timeline: timelineFor(i), allowedActions: allowed(i.status) } : null; }
  if (p === "/incidents") {
    let list = incidents;
    if (q.get("open") === "true") list = list.filter((i) => OPEN.includes(i.status));
    if (q.get("severity")) list = list.filter((i) => q.get("severity")!.split(",").includes(i.severity));
    if (q.get("status")) list = list.filter((i) => q.get("status")!.split(",").includes(i.status));
    if (q.get("category")) list = list.filter((i) => i.category === q.get("category"));
    if (q.get("department")) list = list.filter((i) => i.department === q.get("department"));
    if (q.get("deviceId")) list = list.filter((i) => i.deviceId === q.get("deviceId"));
    if (q.get("source")) list = list.filter((i) => q.get("source")!.split(",").includes(i.source));
    if (q.get("escalated") === "true") list = list.filter((i) => i.status === "Escalated" || i.escalationLevel > 0);
    if (q.get("since")) list = list.filter((i) => i.createdAt >= q.get("since")!);
    if (q.get("mine") === "true" || (mockRoles.length === 1 && mockRoles[0] === "citizen")) list = list.filter((i) => i.source === "citizen");
    return list.slice(0, Number(q.get("limit") ?? 100));
  }
  if (p === "/advisories") return q.get("all") === "true" ? advisories : advisories.filter((a) => a.active);
  if (p === "/shift-log") return shiftLog;
  // sla
  if (p === "/sla/summary") return { open: { green: 9, amber: 3, red: 2 }, responseCompliancePct: 94.2, resolutionCompliancePct: 88.7, window: "30d" };
  if (p === "/sla/timers") return (q.get("incidentIds") ?? "").split(",").filter(Boolean).map((id, n) => { const i = incidents.find((x) => x.id === id); return i ? timerFor(i, n) : null; }).filter(Boolean);
  if (p === "/sla/at-risk") {
    const out: Any[] = [];
    incidents.filter((i) => OPEN.includes(i.status)).forEach((i, n) => {
      const t = timerFor(i, n);
      if (!t.responseMet) out.push({ incidentId: i.id, clock: "response", severity: i.severity, category: i.category, dueAt: t.responseDue, remainingMs: new Date(t.responseDue).getTime() - Date.now(), rag: t.response, escalateTo: t.escalateTo });
      out.push({ incidentId: i.id, clock: "resolution", severity: i.severity, category: i.category, dueAt: t.resolutionDue, remainingMs: new Date(t.resolutionDue).getTime() - Date.now(), rag: t.resolution, escalateTo: t.escalateTo });
    });
    return out.sort((a, b) => a.remainingMs - b.remainingMs).slice(0, Number(q.get("limit") ?? 20));
  }
  if (p === "/sla/policies") return { defaults: { Critical: { responseMin: 5, resolutionMin: 240, amberPct: 75, escalateTo: "dept_head,city_admin", autoEscalate: true }, High: { responseMin: 15, resolutionMin: 480, amberPct: 75, escalateTo: "dept_head", autoEscalate: true }, Medium: { responseMin: 60, resolutionMin: 1440, amberPct: 80, escalateTo: "operator", autoEscalate: false }, Low: { responseMin: 240, resolutionMin: 4320, amberPct: 80, escalateTo: "", autoEscalate: false } }, overrides: slaOverrides };
  if (p === "/work-orders") {
    let list = workOrders;
    if (q.get("assignee") === "me" || (mockRoles.length === 1 && mockRoles[0] === "field_tech")) list = list.filter((w) => w.assignee === "tech.delhi");
    if (q.get("incidentId")) list = list.filter((w) => w.incidentId === q.get("incidentId"));
    if (q.get("department")) list = list.filter((w) => w.department === q.get("department"));
    return list;
  }
  // tenant-service
  if (p === "/tenants") return tenants;
  if (p === "/plans") return PLANS;
  if (p === "/departments") return departments;
  if (p === "/users") return users;
  if (p === "/announcements") return q.get("all") === "true" ? announcements : announcements.filter((a) => !a.endsAt || a.endsAt > now());
  m = /^\/tenants\/([^/]+)\/api-keys$/.exec(p);
  if (m) return apiKeys;
  m = /^\/tenants\/([^/]+)$/.exec(p);
  if (m) return tenants.find((t) => t.id === m![1]) ?? tenants[0];
  if (p === "/platform/usage") return platformUsage();
  // notifications, audit, ops
  if (p === "/notifications") return incidents.slice(0, 8).map((i, n) => ({ id: n, channel: n % 3 ? "email" : "sms", recipient: n % 3 ? "control-room@delhi.scaas.local" : "+910000000000", kind: "incident.created", subject: `[${i.severity}] ${i.ref} ${i.title}`, status: n === 5 ? "failed" : "sent", at: i.createdAt }));
  if (p === "/notifications/channels") return channels;
  if (p === "/notifications/preferences") return preferences;
  if (p === "/audit") return auditLog;
  if (p === "/system/health") return SERVICES.map((s) => ({ service: s, status: "up", latencyMs: Math.round(3 + rnd() * 20) }));
  if (p === "/connectors") return { weather: { provider: "open-meteo", intervalMin: 10 }, events: { provider: "demo" }, traffic: { provider: "none" }, batch: { endpoint: "POST /api/connectors/batch" } };
  return null;
}

function connection(deviceId: string, token?: string) {
  const r = reg(deviceId);
  const keys = CATALOG.find((c) => c.name === r?.deviceType)?.telemetry.slice(0, 3) ?? ["value"];
  const values = Object.fromEntries(keys.map((k: string) => [k, 0]));
  return {
    protocol: r?.protocol ?? "http-ingest",
    mqtt: token ? { host: "localhost", port: 1883, username: token, topic: "v1/devices/me/telemetry", payload: values } : undefined,
    http: token ? { url: `http://localhost:8080/api/v1/${token}/telemetry`, curl: `curl -X POST http://localhost:8080/api/v1/${token}/telemetry -H 'content-type: application/json' -d '${JSON.stringify(values)}'` } : undefined,
    ingest: { url: `http://localhost:8091/v1/devices/${deviceId}/telemetry`, curl: `curl -X POST http://localhost:8091/v1/devices/${deviceId}/telemetry -H 'x-api-key: <your API key>' -H 'content-type: application/json' -d '${JSON.stringify({ values })}'` },
  };
}

const DEVICE_NEXT: Record<string, [string[], string]> = {
  register: [["Discovered"], "Registered"], commission: [["Registered", "Provisioned"], "Active"], maintenance: [["Active", "Faulty"], "Maintenance"],
  fault: [["Active", "Maintenance"], "Faulty"], restore: [["Maintenance", "Faulty"], "Active"], decommission: [["Discovered", "Registered", "Provisioned", "Active", "Maintenance", "Faulty"], "Decommissioned"],
};

function fail(msg: string): never { const e = new Error(msg); (e as any).status = 409; throw e; }

/** Demo-mode mutations, so buttons work in a disconnected demo. */
export function mockMutate(method: string, path: string, body: any): any {
  body = body ?? {};
  let m = /^\/incidents\/([^/]+)\/transition$/.exec(path);
  if (m) {
    const i = incidents.find((x) => x.id === m![1]);
    if (!i) return null;
    const rule = RULES[body.action];
    if (!rule || !rule[0].includes(i.status)) fail(`Cannot ${body.action} an incident that is ${i.status}`);
    if (body.action === "dismiss" && !body.closureCode) fail("dismiss needs a closureCode");
    const from = i.status;
    let to = rule[1] ?? i.status;
    if (body.action === "escalate") { i.escalationLevel++; to = ["Assigned", "In Progress"].includes(from) ? "Escalated" : from; }
    if (body.action === "assign" && from === "In Progress") to = "In Progress";
    i.status = to;
    if (body.action === "acknowledge" || (body.action === "assign" && from === "New")) i.acknowledgedAt ??= now();
    if (["resolve", "confirm"].includes(body.action)) i.resolvedAt = now();
    if (["close", "dismiss"].includes(body.action)) i.closedAt = now();
    if (body.closureCode) i.closureCode = body.closureCode;
    if (body.assignee) i.assignee = body.assignee;
    if (body.department) i.department = body.department;
    i.updatedAt = now();
    timelineFor(i).push({ type: body.action === "escalate" ? "escalated" : "status.changed", actor: mockUser, data: { from, to, action: body.action, note: body.note, assignee: body.assignee, closureCode: body.closureCode }, at: now() });
    return { ...i, allowedActions: allowed(i.status) };
  }
  m = /^\/incidents\/([^/]+)\/comments$/.exec(path);
  if (m) { const i = incidents.find((x) => x.id === m![1]); if (i) timelineFor(i).push({ type: "comment", actor: mockUser, data: { note: body.note }, at: now() }); return { ok: true }; }
  if (method === "POST" && path === "/incidents") {
    const citizen = mockRoles.length === 1 && mockRoles[0] === "citizen";
    const dept = departments.find((d) => d.categories.includes(body.category))?.name ?? "Operations";
    const i = { id: uuid(), ref: `INC-${String(2000 + incidents.length).padStart(6, "0")}`, tenantId: "delhi", status: body.assignee && !citizen ? "Assigned" : "New", source: citizen ? "citizen" : "operator", escalationLevel: 0, createdAt: now(), updatedAt: now(), department: dept, reporter: citizen ? "dev-citizen.delhi" : undefined, ...body, severity: citizen ? "Medium" : body.severity ?? "Medium", photos: body.photos ?? [] };
    incidents.unshift(i);
    return i;
  }
  if (method === "POST" && path === "/advisories") { const a = { id: uuid(), startsAt: now(), endsAt: body.hours ? new Date(Date.now() + body.hours * 3600_000).toISOString() : undefined, publishedBy: mockUser, active: true, level: "info", category: "general", ...body }; advisories.unshift(a); return a; }
  m = /^\/advisories\/([^/]+)\/end$/.exec(path);
  if (m) { const a = advisories.find((x) => x.id === m![1]); if (a) { a.active = false; a.endsAt = now(); } return { ended: true }; }
  if (method === "POST" && path === "/shift-log") { const s = { id: shiftLog.length + 1, author: mockUser, at: now(), openItems: [], ...body }; shiftLog.unshift(s); return s; }
  m = /^\/work-orders\/([^/]+)\/transition$/.exec(path);
  if (m) {
    const w = workOrders.find((x) => x.id === m![1]);
    const to: Record<string, string> = { assign: "Assigned", accept: "Accepted", start: "In Progress", hold: "On Hold", resume: "In Progress", complete: "Completed", verify: "Verified", close: "Closed", cancel: "Cancelled", reject: "In Progress" };
    if (w) {
      w.status = to[body.action] ?? w.status; w.updatedAt = now();
      if (body.checklist) w.checklist = body.checklist;
      if (body.evidence) w.evidence = [...(w.evidence ?? []), ...body.evidence];
      if (body.assignee) w.assignee = body.assignee;
      if (body.action === "complete" && w.incidentId) { const i = incidents.find((x) => x.id === w.incidentId); if (i && ["Assigned", "In Progress", "Escalated"].includes(i.status)) { const from = i.status; i.status = "Resolution Pending"; timelineFor(i).push({ type: "status.changed", actor: mockUser, data: { from, to: "Resolution Pending", action: "complete", note: `Work order ${w.ref} completed` }, at: now() }); } }
    }
    return w;
  }
  if (method === "POST" && path === "/work-orders") {
    const w = { id: uuid(), ref: `WO-${String(400 + workOrders.length).padStart(6, "0")}`, status: body.assignee ? "Assigned" : "Open", createdAt: now(), updatedAt: now(), checklist: [], evidence: [], createdBy: mockUser, ...body };
    workOrders.unshift(w);
    return w;
  }
  // registry
  if (method === "POST" && path === "/assets/devices") {
    if (reg(body.deviceId)) fail(`Device ${body.deviceId} is already registered`);
    const site = body.siteId ? sites.find((s) => s.id === body.siteId) : body.siteName ? ensureSite(body.siteName, body.zone, body.lat, body.lon) : undefined;
    const asset = body.assetName ? ensureAsset(body.assetName, site, body.department, body.criticality) : body.assetId ? assets.find((a) => a.id === body.assetId) : undefined;
    const d = { status: "Registered", domain: DOMAIN_OF[body.deviceType] ?? "generic", online: false, createdBy: mockUser, createdAt: now(), updatedAt: now(), ...body, siteId: site?.id, siteName: site?.name, assetId: asset?.id, assetName: asset?.name };
    registry.unshift(d); devEvent(d.deviceId, "registered", { zone: d.zone });
    return d;
  }
  if (method === "POST" && path.startsWith("/assets/devices/import")) {
    const lines = String(body.csv ?? "").trim().split(/\r?\n/);
    const head = lines[0].split(",").map((h) => h.trim());
    const rows = lines.slice(1).map((l, n) => ({ line: n + 2, ...Object.fromEntries(l.split(",").map((v, k) => [head[k], v.trim()])) })) as Any[];
    const issues: Any[] = [];
    const seen = new Set<string>();
    const valid = rows.filter((r) => {
      if (!r.deviceId) { issues.push({ line: r.line, field: "deviceId", message: "deviceId is required" }); return false; }
      if (seen.has(r.deviceId)) { issues.push({ line: r.line, deviceId: r.deviceId, field: "deviceId", message: "Duplicate deviceId in this file" }); return false; }
      seen.add(r.deviceId);
      if (!CATALOG.some((c) => c.name === r.deviceType)) { issues.push({ line: r.line, deviceId: r.deviceId, field: "deviceType", message: `Unknown device type "${r.deviceType}"` }); return false; }
      return true;
    }).map((r) => ({ ...r, protocol: r.protocol || "http-ingest", criticality: r.criticality || "Medium", lat: r.lat ? Number(r.lat) : undefined, lon: r.lon ? Number(r.lon) : undefined, action: reg(r.deviceId) ? "update" : "create" } as Any));
    if (path.includes("dryRun=true") || issues.length) return { dryRun: true, valid: valid.length, invalid: issues.length, issues, preview: valid };
    let created = 0, updated = 0;
    for (const r of valid) {
      const ex = reg(r.deviceId);
      if (ex) { Object.assign(ex, r); updated++; continue; }
      const site = r.site ? ensureSite(r.site, r.zone, r.lat, r.lon) : undefined;
      const asset = r.asset ? ensureAsset(r.asset, site, r.department, r.criticality) : undefined;
      registry.unshift({ ...r, status: "Registered", domain: DOMAIN_OF[r.deviceType], online: false, siteId: site?.id, siteName: site?.name, assetId: asset?.id, assetName: asset?.name, createdBy: mockUser, createdAt: now(), updatedAt: now() });
      created++;
    }
    return { dryRun: false, created, updated, issues: [] };
  }
  m = /^\/assets\/devices\/([^/]+)\/provision$/.exec(path);
  if (m) {
    const d = reg(decodeURIComponent(m[1]));
    if (!d) fail("Device not in registry");
    if (["Discovered", "Decommissioned"].includes(d.status)) fail(`Cannot provision a device that is ${d.status}`);
    const token = uuid().replace(/-/g, "").slice(0, 20);
    if (["Registered", "Provisioned"].includes(d.status)) d.status = "Provisioned";
    d.tbDeviceId ??= uuid(); d.updatedAt = now();
    devEvent(d.deviceId, "provisioned", { tbDeviceId: d.tbDeviceId });
    // the device "starts reporting" a few seconds later in the demo
    setTimeout(() => { d.lastSeen = now(); d.firstSeen ??= now(); d.online = true; }, 6000);
    return { device: d, token, note: "Store the access token now; it is shown once.", connection: connection(d.deviceId, token) };
  }
  m = /^\/assets\/devices\/([^/]+)\/transition$/.exec(path);
  if (m) {
    const d = reg(decodeURIComponent(m[1]));
    if (!d) fail("Device not in registry");
    const r = DEVICE_NEXT[body.action];
    if (!r || !r[0].includes(d.status)) fail(`Cannot ${body.action} a device that is ${d.status}`);
    const from = d.status; d.status = r[1]; d.updatedAt = now();
    devEvent(d.deviceId, `status.${body.action}`, { from, to: d.status, note: body.note });
    return d;
  }
  m = /^\/assets\/devices\/([^/]+)$/.exec(path);
  if (m && method === "PUT") {
    const d = reg(decodeURIComponent(m[1]));
    if (!d) fail("Device not in registry");
    const site = body.siteId ? sites.find((s) => s.id === body.siteId) : body.siteName ? ensureSite(body.siteName, body.zone ?? d.zone, body.lat ?? d.lat, body.lon ?? d.lon) : undefined;
    const asset = body.assetName ? ensureAsset(body.assetName, site, body.department, body.criticality) : undefined;
    const wasDiscovered = d.status === "Discovered";
    Object.assign(d, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)), site ? { siteId: site.id, siteName: site.name } : {}, asset ? { assetId: asset.id, assetName: asset.name } : {});
    if (body.profileId) d.profileName = mappingProfiles.find((x) => x.id === body.profileId)?.name;
    if (wasDiscovered) d.status = "Registered";
    d.updatedAt = now();
    devEvent(d.deviceId, wasDiscovered ? "mapped" : "updated", { zone: d.zone, site: d.siteName });
    return d;
  }
  if (method === "POST" && path === "/assets/sites") return { id: ensureSite(body.name, body.zone, body.lat, body.lon).id };
  if (method === "POST" && path === "/assets/assets") return { id: ensureAsset(body.name, sites.find((s) => s.id === body.siteId), body.department, body.criticality).id };
  if (method === "POST" && path === "/assets/mapping-profiles") { const mp = { id: uuid(), createdAt: now(), devices: 0, ...body }; mappingProfiles.push(mp); return { id: mp.id }; }
  m = /^\/assets\/mapping-profiles\/([^/]+)$/.exec(path);
  if (m && method === "PUT") { const mp = mappingProfiles.find((x) => x.id === m![1]); if (mp) Object.assign(mp, body); return { updated: true }; }
  if (m && method === "DELETE") { const k = mappingProfiles.findIndex((x) => x.id === m![1]); if (k >= 0) mappingProfiles.splice(k, 1); return { deleted: true }; }
  // tenant / platform
  if (method === "POST" && path === "/tenants") {
    const plan = (PLANS.plans as Any)[body.plan ?? "standard"];
    const t = { ...body, status: "provisioning", modules: body.modules ?? plan.modules, effectiveQuotas: { ...plan.quotas, ...(body.quotas ?? {}) }, zones: body.zones ?? [], branding: {}, createdAt: now(), provisionLog: [{ at: now(), step: "Provisioning started", ok: true }] };
    tenants.push(t);
    const steps = ["ThingsBoard tenant ready", "Device profiles, zone assets and rule chain (Kafka export) configured", "Keycloak group /tenants/" + body.id + " ready", ...(body.adminUser ? [`First City Admin created: ${body.adminUser.username}`] : []), "City is active"];
    steps.forEach((s, k) => setTimeout(() => { t.provisionLog.push({ at: now(), step: s, ok: true }); if (k === steps.length - 1) t.status = "active"; }, 1500 * (k + 1)));
    return { id: body.id, status: "provisioning", admin: body.adminUser?.username };
  }
  m = /^\/tenants\/([^/]+)\/provision$/.exec(path);
  if (m) { const t = tenants.find((x) => x.id === m![1]); if (t) { t.status = "provisioning"; setTimeout(() => { t.status = "active"; t.provisionLog.push({ at: now(), step: "City is active", ok: true }); }, 3000); } return { status: "provisioning" }; }
  m = /^\/tenants\/([^/]+)$/.exec(path);
  if (m && method === "PUT") {
    const t = tenants.find((x) => x.id === m![1]);
    if (!t) return null;
    Object.assign(t, body);
    if (body.plan) { const plan = (PLANS.plans as Any)[body.plan]; t.effectiveQuotas = { ...plan.quotas, ...(t.quotas ?? {}) }; t.modules = (body.modules ?? t.modules).filter((x: string) => plan.modules.includes(x)); }
    return t;
  }
  if (method === "POST" && path === "/departments") { const id = body.id ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"); const k = departments.findIndex((d) => d.id === id); const d = { id, ...body }; if (k >= 0) departments[k] = d; else departments.push(d); return d; }
  m = /^\/departments\/([^/]+)$/.exec(path);
  if (m && method === "DELETE") { const k = departments.findIndex((d) => d.id === m![1]); if (k >= 0) departments.splice(k, 1); return { deleted: true }; }
  if (method === "POST" && path === "/users") { const u = { id: uuid(), enabled: true, roles: [body.role], createdAt: Date.now(), ...body }; users.push(u); return { id: u.id, username: u.username, temporaryPassword: "Tmp-demo-9!", note: "Demo only" }; }
  m = /^\/users\/([^/]+)\/reset-password$/.exec(path);
  if (m) return { temporaryPassword: "Tmp-reset-9!" };
  m = /^\/users\/([^/]+)$/.exec(path);
  if (m && method === "PUT") { const u = users.find((x) => x.id === m![1]); if (u) { if (body.role) u.roles = [body.role]; if (body.enabled !== undefined) u.enabled = body.enabled; } return { updated: true }; }
  if (method === "POST" && path === "/announcements") { const a = { id: uuid(), tenantId: body.tenantId || "*", startsAt: now(), createdBy: mockUser, level: "info", ...body }; announcements.unshift(a); return { id: a.id }; }
  m = /^\/announcements\/([^/]+)$/.exec(path);
  if (m && method === "DELETE") { const a = announcements.find((x) => x.id === m![1]); if (a) a.endsAt = now(); return { ended: true }; }
  if (method === "PUT" && path === "/sla/policies") { for (const p of body) { const k = slaOverrides.findIndex((o) => o.category === p.category && o.severity === p.severity); const row = { category: p.category, severity: p.severity, response_min: p.responseMin, resolution_min: p.resolutionMin, amber_pct: p.amberPct, escalate_to: p.escalateTo, auto_escalate: p.autoEscalate }; if (k >= 0) slaOverrides[k] = row; else slaOverrides.push(row); } return { updated: body.length }; }
  if (method === "POST" && path === "/notifications/channels") { const c = { id: uuid(), enabled: true, min_severity: body.minSeverity, ...body }; channels.push(c); return c; }
  m = /^\/notifications\/channels\/([^/]+)$/.exec(path);
  if (m && method === "DELETE") { const k = channels.findIndex((c) => c.id === m![1]); if (k >= 0) channels.splice(k, 1); return { deleted: true }; }
  if (m && method === "PUT") { const c = channels.find((x) => x.id === m![1]); if (c) c.enabled = body.enabled; return { updated: true }; }
  if (method === "PUT" && path === "/notifications/preferences") { preferences = { ...preferences, ...body }; return { saved: true }; }
  if (method === "POST" && path === "/notifications/broadcast") return { sent: true };
  if (method === "POST" && /\/api-keys$/.test(path)) { const k = { id: uuid(), name: body?.name, prefix: "sk_delhi_" + uuid().slice(0, 3), scopes: ["telemetry:write"], created_by: mockUser, created_at: now() }; apiKeys.unshift(k); return { ...k, key: `sk_delhi_${uuid().replace(/-/g, "")}`, note: "Demo key (not valid against a real backend)" }; }
  m = /\/api-keys\/([^/]+)$/.exec(path);
  if (m && method === "DELETE") { const k = apiKeys.find((x) => x.id === m![1]); if (k) k.revoked_at = now(); return { revoked: true }; }
  return { ok: true };
}

function ensureSite(name: string, zone?: string, lat?: number, lon?: number) {
  let s = sites.find((x) => x.name === name);
  if (!s) { s = { id: uuid(), code: name.toLowerCase().replace(/\W+/g, "-"), name, zone, kind: "site", lat, lon }; sites.push(s); }
  return s;
}
function ensureAsset(name: string, site?: Any, department?: string, criticality?: string) {
  let a = assets.find((x) => x.name === name);
  if (!a) { a = { id: uuid(), siteId: site?.id, siteName: site?.name, code: name.toLowerCase().replace(/\W+/g, "-"), name, kind: "asset", department, criticality: criticality ?? "Medium" }; assets.push(a); }
  return a;
}

/** Simulated live events for demo mode (moving fleet, telemetry, the odd incident). */
export function mockLiveEvent(): { event: string; data: Any } {
  for (const v of movers) {
    v.orbit.phase += v.orbit.speed * 0.05;
    v.lat = CENTER.lat + v.orbit.r * Math.sin(v.orbit.phase);
    v.lon = CENTER.lon + v.orbit.r * Math.cos(v.orbit.phase) * 1.15;
    v.ts = Date.now();
  }
  if (rnd() < 0.12) {
    const i = pick(incidents.filter((x) => OPEN.includes(x.status)));
    return { event: "incident", data: { type: "incident.updated", entity: { type: "INCIDENT", id: i.id, name: i.ref }, occurredAt: now(), data: { incident: i, action: "update" } } };
  }
  const d = rnd() < 0.4 ? pick(movers) : pick(devices);
  if (!d.orbit) d.values = valuesFor(d.deviceType);
  d.ts = Date.now();
  return { event: "twin", data: { type: "observation.recorded", entity: { type: "DEVICE", id: d.deviceId, name: d.deviceId }, occurredAt: now(), data: { deviceId: d.deviceId, deviceType: d.deviceType, values: d.values, location: { lat: d.lat, lon: d.lon } } } };
}
