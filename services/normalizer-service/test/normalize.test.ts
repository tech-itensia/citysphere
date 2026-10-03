import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, inferDeviceType } from "../src/normalize.ts";

const base = { eventId: "e1", type: "telemetry.received", version: 1, tenantId: "delhi", source: "ingest-api" };

test("aliases, coercion, unit conversion and location extraction", () => {
  const o = normalize({ ...base, occurredAt: "2026-10-02T10:00:00.000Z",
    data: { deviceId: "AQ-7", values: { "pm2.5": "41.2", tempF: 86, lat: 28.61, lon: 77.2, ok: "true", ingestSource: "kafka" } } } as any,
    Date.parse("2026-10-02T10:00:01Z"));
  assert.equal(o.deviceType, "Air Quality Station");
  assert.equal(o.values.pm25, 41.2);
  assert.equal(o.values.tempC, 30);
  assert.equal(o.values.ok, true);
  assert.equal(o.values.ingestSource, undefined);
  assert.deepEqual(o.location, { lat: 28.61, lon: 77.2 });
});

test("future timestamps are clamped to now", () => {
  const now = Date.parse("2026-10-02T10:00:00Z");
  const o = normalize({ ...base, occurredAt: "2027-01-01T00:00:00Z", data: { deviceId: "SL-1", values: { powerW: 3 } } } as any, now);
  assert.equal(o.ts, now);
});

test("missing values is non-retryable", () => {
  assert.throws(() => normalize({ ...base, occurredAt: "2026-10-02T10:00:00Z", data: { deviceId: "SL-1" } } as any), /values missing/);
});

test("device type inference", () => {
  assert.equal(inferDeviceType("WB-12"), "Smart Bin");
  assert.equal(inferDeviceType("xyz-1"), "Generic Sensor");
  assert.equal(inferDeviceType("SL-1", "Custom"), "Custom");
});

test("epoch-ms string timestamps from ThingsBoard are understood", () => {
  const o = normalize({ ...base, source: "thingsboard", occurredAt: "1790000000000", data: { deviceId: "SL-1", values: { powerW: 3 } } } as any, 1790000000500);
  assert.equal(o.ts, 1790000000000);
});
