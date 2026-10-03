import { z } from "zod";

/** Telemetry record accepted by ingest-service and carried on scaas.raw.telemetry. */
export const TelemetryValue = z.union([z.number(), z.string().max(1024), z.boolean()]);

export const TelemetryRecord = z.object({
  deviceId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/, "deviceId may contain letters, digits, . _ : -"),
  deviceType: z.string().min(1).max(64).optional(),
  ts: z.union([z.number(), z.string()]).optional(),
  values: z.record(z.string().min(1).max(64), TelemetryValue).refine((v) => Object.keys(v).length > 0, "values must not be empty"),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  zone: z.string().max(64).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});
export type TelemetryRecordT = z.infer<typeof TelemetryRecord>;

/** Normalized observation on scaas.normalized.observations. */
export interface Observation {
  deviceId: string;
  deviceType: string;
  ts: number;
  values: Record<string, number | string | boolean>;
  location?: { lat: number; lon: number };
  zone?: string;
  attributes?: Record<string, unknown>;
  origin: string; // thingsboard | ingest-api | connector:<name>
}

/** Alarm event on scaas.alerts (published by the ThingsBoard rule chain). */
export interface AlarmData {
  alarmId: string;
  alarmType: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR" | "WARNING" | "INDETERMINATE";
  status: string;
  deviceId: string;
  deviceType?: string;
  startTs?: number;
  details?: Record<string, unknown>;
}

export const Severity = ["Critical", "High", "Medium", "Low"] as const;
export type SeverityT = (typeof Severity)[number];

export const Personas = [
  "super_admin", "city_admin", "leadership", "operator", "dept_head",
  "field_tech", "analyst", "it_ops", "citizen",
] as const;
export type Persona = (typeof Personas)[number];
