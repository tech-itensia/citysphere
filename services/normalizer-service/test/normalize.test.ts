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

import { applyRegistry } from "../src/normalize.ts";

test("registry mapping profile renames, scales and drops vendor keys", () => {
  const obs = { deviceId: "ACME-AQ-901", deviceType: "Air Quality Station", ts: 1, origin: "ingest-api", values: { pm2_5_ugm3: 50, temp_f: 86, rssi: -70 }, location: { lat: 1, lon: 2 } };
  const out = applyRegistry(obs, { deviceId: "ACME-AQ-901", deviceType: "Air Quality Station", status: "Active", zone: "CP", lat: 28.6, lon: 77.2,
    rules: [{ from: "pm2_5_ugm3", to: "pm25" }, { from: "temp_f", to: "temperatureC", scale: 0.5556, offset: -17.778 }, { from: "rssi", to: "", drop: true }] })!;
  assert.equal(out.values.pm25, 50);
  assert.ok(Math.abs((out.values.temperatureC as number) - 30) < 0.05);
  assert.equal(out.values.rssi, undefined);
  assert.equal(out.zone, "CP");
  assert.deepEqual(out.location, { lat: 28.6, lon: 77.2 });
  assert.equal(out.attributes?.registryStatus, "Active");
});

test("registry keeps live location for moving assets and drops decommissioned devices", () => {
  const obs = { deviceId: "VH-1", deviceType: "Vehicle", ts: 1, origin: "ingest-api", values: { speedKmh: 30 }, location: { lat: 5, lon: 6 } };
  assert.deepEqual(applyRegistry(obs, { deviceId: "VH-1", deviceType: "Vehicle", status: "Active", lat: 1, lon: 1 })!.location, { lat: 5, lon: 6 });
  assert.equal(applyRegistry(obs, { deviceId: "VH-1", deviceType: "Vehicle", status: "Decommissioned" }), undefined);
  assert.equal(applyRegistry(obs, undefined), obs);
});
