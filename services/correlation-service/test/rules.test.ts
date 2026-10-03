import { test } from "node:test";
import assert from "node:assert/strict";
import { Correlator } from "../src/rules.ts";

test("rain + two congestion alarms -> one correlated alert, then cool-down", () => {
  const c = new Correlator();
  const t = 1_000_000;
  assert.deepEqual(c.add("delhi", { kind: "observation", at: t, deviceId: "WX-delhi", deviceType: "Weather Feed", values: { rainMm: 14 } }, t), []);
  assert.deepEqual(c.add("delhi", { kind: "alarm", at: t + 1, deviceId: "TJ-1", alarmType: "Congestion", severity: "MAJOR" }, t + 1), []);
  const fired = c.add("delhi", { kind: "alarm", at: t + 2, deviceId: "TJ-2", alarmType: "Congestion", severity: "MAJOR" }, t + 2);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].alarmType, "Rain-Induced Congestion");
  assert.equal(c.add("delhi", { kind: "alarm", at: t + 3, deviceId: "TJ-3", alarmType: "Congestion", severity: "MAJOR" }, t + 3).length, 0);
});

test("three low-pressure nodes in one zone -> possible main break", () => {
  const c = new Correlator();
  const t = 5_000_000;
  const add = (id: string, i: number) => c.add("pune", { kind: "alarm", at: t + i, deviceId: id, zone: "Z1", alarmType: "Low Water Pressure", severity: "MAJOR" }, t + i);
  add("WN-1", 0);
  add("WN-2", 1);
  const fired = add("WN-3", 2);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].severity, "CRITICAL");
  assert.equal(fired[0].zone, "Z1");
});

test("cleared alarms leave the window", () => {
  const c = new Correlator();
  const t = 9_000_000;
  c.add("x", { kind: "observation", at: t, deviceId: "WX", deviceType: "Weather Feed", values: { rainMm: 30 } }, t);
  c.add("x", { kind: "alarm", at: t, deviceId: "TJ-1", alarmType: "Congestion", severity: "MAJOR" }, t);
  c.add("x", { kind: "alarm", at: t, deviceId: "TJ-1", alarmType: "Congestion", severity: "CLEARED" }, t);
  assert.equal(c.add("x", { kind: "alarm", at: t, deviceId: "TJ-2", alarmType: "Congestion", severity: "MAJOR" }, t).length, 0);
});
