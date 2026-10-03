import { TelemetryRecord, makeEvent, toIso, type EventEnvelope, type TelemetryRecordT } from "@scaas/common";

export const MAX_BATCH = 1000;

export interface IngestResult {
  events: EventEnvelope<TelemetryRecordT & { receivedAt: string }>[];
  rejected: Array<{ index: number; deviceId?: string; error: string }>;
}

/** Accepts one record, an array, or { records: [...] }; returns envelopes for valid records. */
export function buildEvents(tenantId: string, body: unknown, source = "ingest-api"): IngestResult {
  const list: unknown[] = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { records?: unknown }).records)
      ? (body as { records: unknown[] }).records
      : [body];

  const result: IngestResult = { events: [], rejected: [] };
  if (list.length > MAX_BATCH) {
    result.rejected.push({ index: -1, error: `Batch too large: ${list.length} records (max ${MAX_BATCH})` });
    return result;
  }
  const receivedAt = new Date().toISOString();
  list.forEach((item, index) => {
    const parsed = TelemetryRecord.safeParse(item);
    if (!parsed.success) {
      const deviceId = (item as { deviceId?: unknown })?.deviceId;
      result.rejected.push({
        index,
        deviceId: typeof deviceId === "string" ? deviceId : undefined,
        error: parsed.error.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join(".") || "record"}: ${i.message}`).join("; "),
      });
      return;
    }
    const rec = parsed.data as TelemetryRecordT;
    let occurredAt: string;
    try {
      occurredAt = toIso(rec.ts ?? Date.now());
    } catch {
      result.rejected.push({ index, deviceId: rec.deviceId, error: "ts: invalid timestamp" });
      return;
    }
    result.events.push(makeEvent({
      type: "telemetry.received",
      tenantId,
      source,
      entity: { type: "DEVICE", id: rec.deviceId },
      occurredAt,
      data: { ...rec, receivedAt },
    }));
  });
  return result;
}

/** `POST /v1/devices/:id/telemetry` accepts `{ values: {...} }` or a flat key/value object. */
export function recordFromDeviceBody(deviceId: string, body: Record<string, unknown>, ts?: string): unknown {
  if (body && typeof body === "object" && "values" in body) return { ...body, deviceId };
  const { deviceType, location, zone, ...values } = body ?? {};
  return { deviceId, deviceType, location, zone, ts, values };
}
