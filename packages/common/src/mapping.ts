/**
 * Device registry projection shared by services through Redis (written by asset-service).
 * normalizer applies vendor-key mapping rules and registry overrides; incident-service reads status and ownership.
 * Pure helpers + key names only; no I/O here.
 */
export type DeviceStatus = "Discovered" | "Registered" | "Provisioned" | "Active" | "Maintenance" | "Faulty" | "Decommissioned";

export interface MappingRule {
  from: string;            // vendor key, e.g. "press_kpa"
  to: string;              // canonical key, e.g. "pressureBar"
  scale?: number;          // multiply (default 1)
  offset?: number;         // then add (default 0)
  drop?: boolean;          // remove the key entirely
}

export interface DeviceMapEntry {
  deviceId: string;
  deviceType: string;
  status: DeviceStatus;
  zone?: string;
  lat?: number;
  lon?: number;
  department?: string;
  site?: string;
  asset?: string;
  criticality?: string;
  rules?: MappingRule[];
}

/** Redis hash per tenant: field = deviceId, value = JSON DeviceMapEntry. */
export const DEVMAP = "devmap";

/** Apply mapping rules to a values object; unknown keys pass through untouched. */
export function applyMapping(values: Record<string, unknown>, rules: MappingRule[] = []): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  const byFrom = new Map(rules.map((r) => [r.from, r]));
  for (const [k, v] of Object.entries(values)) {
    const r = byFrom.get(k);
    if (r?.drop) continue;
    if (v === null || v === undefined || typeof v === "object") continue;
    if (!r) { out[k] = v as number | string | boolean; continue; }
    let val: number | string | boolean = v as number | string | boolean;
    const num = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : undefined;
    if (num !== undefined && (r.scale !== undefined || r.offset !== undefined)) {
      val = Math.round((num * (r.scale ?? 1) + (r.offset ?? 0)) * 1e6) / 1e6;
    } else if (num !== undefined) {
      val = num;
    }
    out[r.to || k] = val;
  }
  return out;
}

/** Devices in these states must not raise incidents. */
export const SUPPRESSED_STATUSES: DeviceStatus[] = ["Maintenance", "Decommissioned"];
