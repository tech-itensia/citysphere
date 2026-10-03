/** Device registry rules (lifecycle, CSV validation, geo helpers). Pure and dependency-free so it is unit-tested directly. */
export const DEVICE_STATUSES = ["Discovered", "Registered", "Provisioned", "Active", "Maintenance", "Faulty", "Decommissioned"] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];
export type DeviceAction = "register" | "provision" | "commission" | "maintenance" | "fault" | "restore" | "decommission";

const NOT_RETIRED: DeviceStatus[] = ["Discovered", "Registered", "Provisioned", "Active", "Maintenance", "Faulty"];

export const DEVICE_RULES: Record<DeviceAction, { from: DeviceStatus[]; to: DeviceStatus }> = {
  register: { from: ["Discovered"], to: "Registered" },
  provision: { from: ["Registered", "Provisioned", "Active", "Maintenance", "Faulty"], to: "Provisioned" },
  commission: { from: ["Registered", "Provisioned"], to: "Active" },
  maintenance: { from: ["Active", "Faulty"], to: "Maintenance" },
  fault: { from: ["Active", "Maintenance"], to: "Faulty" },
  restore: { from: ["Maintenance", "Faulty"], to: "Active" },
  decommission: { from: NOT_RETIRED, to: "Decommissioned" },
};

/** Who may perform each lifecycle action (super_admin always may). */
export const DEVICE_ACTION_ROLES: Record<DeviceAction, string[]> = {
  register: ["city_admin", "it_ops"],
  provision: ["city_admin", "it_ops"],
  commission: ["city_admin", "it_ops", "field_tech"],
  maintenance: ["city_admin", "it_ops", "dept_head", "field_tech"],
  fault: ["city_admin", "it_ops", "dept_head", "field_tech", "operator"],
  restore: ["city_admin", "it_ops", "dept_head", "field_tech"],
  decommission: ["city_admin", "it_ops"],
};

export class LifecycleError extends Error {}

export function nextDeviceStatus(current: DeviceStatus, action: DeviceAction): DeviceStatus {
  const rule = DEVICE_RULES[action];
  if (!rule) throw new LifecycleError(`Unknown action ${action}`);
  if (!rule.from.includes(current)) throw new LifecycleError(`Cannot ${action} a device that is ${current}`);
  // provisioning an Active device only rotates credentials; it stays Active
  if (action === "provision" && current !== "Registered" && current !== "Provisioned") return current;
  return rule.to;
}

/** Distance in metres (haversine). */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest zone centre within maxM metres (default 6 km). */
export function nearestZone(p: { lat: number; lon: number }, zones: Array<{ name: string; lat: number; lon: number }>, maxM = 6000): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const z of zones) {
    const d = distanceM(p, z);
    if (!best || d < best.d) best = { name: z.name, d };
  }
  return best && best.d <= maxM ? best.name : undefined;
}

export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ---------------------------------------------------------------- CSV import
export const CSV_COLUMNS = ["deviceId", "name", "deviceType", "serial", "vendor", "model", "firmware", "protocol", "zone", "site", "asset", "department", "criticality", "lat", "lon"] as const;
export const PROTOCOLS = ["mqtt", "http", "http-ingest", "kafka", "connector"] as const;
export const CRITICALITY = ["Critical", "High", "Medium", "Low"] as const;

export interface ImportRow {
  line: number;
  deviceId: string; name?: string; deviceType: string; serial?: string; vendor?: string; model?: string; firmware?: string;
  protocol: (typeof PROTOCOLS)[number]; zone?: string; site?: string; asset?: string; department?: string;
  criticality: (typeof CRITICALITY)[number]; lat?: number; lon?: number;
}
export interface ImportIssue { line: number; deviceId?: string; field?: string; message: string }

/** RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Validate a device CSV against the catalogue; returns clean rows plus every problem found (line numbers are 1-based incl. header). */
export function validateImport(text: string, knownTypes: string[]): { rows: ImportRow[]; issues: ImportIssue[] } {
  const table = parseCsv(text.trim());
  const issues: ImportIssue[] = [];
  if (!table.length) return { rows: [], issues: [{ line: 1, message: "File is empty" }] };
  const header = table[0].map((h) => h.trim());
  const idx = (c: string) => header.findIndex((h) => h.toLowerCase() === c.toLowerCase());
  for (const required of ["deviceId", "deviceType"]) if (idx(required) < 0) issues.push({ line: 1, field: required, message: `Missing column ${required}` });
  if (issues.length) return { rows: [], issues };
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  table.slice(1).forEach((cells, n) => {
    const line = n + 2;
    const get = (c: string) => { const i = idx(c); return i >= 0 ? (cells[i] ?? "").trim() : ""; };
    const deviceId = get("deviceId");
    const bad = (field: string, message: string) => issues.push({ line, deviceId, field, message });
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/.test(deviceId)) { bad("deviceId", "deviceId must be 2-64 chars: letters, digits, . _ : -"); return; }
    if (seen.has(deviceId)) { bad("deviceId", "Duplicate deviceId in this file"); return; }
    seen.add(deviceId);
    const deviceType = get("deviceType");
    if (!knownTypes.includes(deviceType)) { bad("deviceType", `Unknown device type "${deviceType}"`); return; }
    const protocol = (get("protocol") || "http-ingest") as ImportRow["protocol"];
    if (!PROTOCOLS.includes(protocol)) { bad("protocol", `protocol must be one of ${PROTOCOLS.join(", ")}`); return; }
    const criticality = (get("criticality") || "Medium") as ImportRow["criticality"];
    if (!CRITICALITY.includes(criticality)) { bad("criticality", "criticality must be Critical, High, Medium or Low"); return; }
    const latS = get("lat"), lonS = get("lon");
    let lat: number | undefined, lon: number | undefined;
    if (latS || lonS) {
      lat = Number(latS); lon = Number(lonS);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) { bad("lat", "lat/lon must be valid coordinates"); return; }
    }
    const opt = (c: string) => get(c) || undefined;
    rows.push({ line, deviceId, deviceType, protocol, criticality, lat, lon, name: opt("name"), serial: opt("serial"), vendor: opt("vendor"), model: opt("model"),
      firmware: opt("firmware"), zone: opt("zone"), site: opt("site"), asset: opt("asset"), department: opt("department") });
  });
  return { rows, issues };
}

/** Connection details shown to the installer after provisioning. */
export function connectionInfo(p: { protocol: string; deviceId: string; token?: string; tbHost: string; ingestUrl: string; sampleKeys: string[] }) {
  const values = Object.fromEntries(p.sampleKeys.slice(0, 3).map((k) => [k, 0]));
  const mqtt = p.token ? { host: p.tbHost, port: 1883, username: p.token, topic: "v1/devices/me/telemetry", payload: values } : undefined;
  const http = p.token ? { url: `http://${p.tbHost}:8080/api/v1/${p.token}/telemetry`, curl: `curl -X POST http://${p.tbHost}:8080/api/v1/${p.token}/telemetry -H 'content-type: application/json' -d '${JSON.stringify(values)}'` } : undefined;
  const ingest = {
    url: `${p.ingestUrl}/v1/devices/${encodeURIComponent(p.deviceId)}/telemetry`,
    curl: `curl -X POST ${p.ingestUrl}/v1/devices/${encodeURIComponent(p.deviceId)}/telemetry -H 'x-api-key: <your API key>' -H 'content-type: application/json' -d '${JSON.stringify({ values })}'`,
  };
  return { protocol: p.protocol, mqtt, http, ingest };
}
