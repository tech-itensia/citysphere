import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEvents, recordFromDeviceBody } from "../src/ingest.ts";

test("valid batch becomes envelopes keyed by device", () => {
  const r = buildEvents("delhi", { records: [
    { deviceId: "SL-001", deviceType: "Street Light", values: { powerW: 40, status: "ON" } },
    { deviceId: "AQ-1", ts: 1790000000000, values: { pm25: 31.5 }, location: { lat: 28.6, lon: 77.2 } },
  ] });
  assert.equal(r.rejected.length, 0);
  assert.equal(r.events.length, 2);
  assert.equal(r.events[0].tenantId, "delhi");
  assert.equal(r.events[0].entity?.id, "SL-001");
  assert.equal(r.events[1].occurredAt, new Date(1790000000000).toISOString());
});

test("invalid records are rejected with reasons, valid ones still pass", () => {
  const r = buildEvents("delhi", [
    { deviceId: "bad id with spaces", values: { a: 1 } },
    { deviceId: "OK-1", values: {} },
    { deviceId: "OK-2", values: { a: 1 }, ts: "not-a-date" },
    { deviceId: "OK-3", values: { a: 1 } },
  ]);
  assert.equal(r.events.length, 1);
  assert.deepEqual(r.rejected.map((x) => x.index), [0, 1, 2]);
});

test("oversized batch is refused", () => {
  const recs = Array.from({ length: 1001 }, (_, i) => ({ deviceId: `D-${i}`, values: { v: i } }));
  const r = buildEvents("delhi", recs);
  assert.equal(r.events.length, 0);
  assert.equal(r.rejected[0].index, -1);
});

test("flat device body is wrapped into a record", () => {
  const rec = recordFromDeviceBody("WB-9", { fillPct: 91, deviceType: "Smart Bin" }) as any;
  assert.equal(rec.deviceId, "WB-9");
  assert.deepEqual(rec.values, { fillPct: 91 });
  assert.equal(rec.deviceType, "Smart Bin");
});
