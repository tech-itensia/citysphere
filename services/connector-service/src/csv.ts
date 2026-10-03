/**
 * Batch ingestion (SOW 4.1c): CSV with a header row.
 * Required columns: deviceId. Optional: deviceType, ts, lat, lon, zone. Every other column is a telemetry value.
 */
export interface CsvRecord {
  deviceId: string;
  deviceType?: string;
  ts?: string;
  zone?: string;
  location?: { lat: number; lon: number };
  values: Record<string, number | string | boolean>;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const META = new Set(["deviceId", "deviceType", "ts", "lat", "lon", "zone"]);

export function parseCsv(text: string): { records: CsvRecord[]; errors: Array<{ line: number; error: string }> } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const errors: Array<{ line: number; error: string }> = [];
  if (!lines.length) return { records: [], errors: [{ line: 0, error: "empty file" }] };
  const header = splitLine(lines[0]);
  if (!header.includes("deviceId")) return { records: [], errors: [{ line: 1, error: "header must include deviceId" }] };
  const records: CsvRecord[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = splitLine(line);
    if (cells.length !== header.length) { errors.push({ line: i + 2, error: `expected ${header.length} columns, got ${cells.length}` }); return; }
    const row = Object.fromEntries(header.map((h, j) => [h, cells[j]]));
    if (!row.deviceId) { errors.push({ line: i + 2, error: "deviceId empty" }); return; }
    const values: Record<string, number | string | boolean> = {};
    for (const h of header) {
      if (META.has(h) || row[h] === "") continue;
      const v = row[h];
      values[h] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : /^(true|false)$/i.test(v) ? v.toLowerCase() === "true" : v;
    }
    if (!Object.keys(values).length) { errors.push({ line: i + 2, error: "no values" }); return; }
    const lat = Number(row.lat), lon = Number(row.lon);
    records.push({
      deviceId: row.deviceId, deviceType: row.deviceType || undefined, ts: row.ts || undefined, zone: row.zone || undefined,
      location: row.lat && row.lon && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined, values,
    });
  });
  return { records, errors };
}
