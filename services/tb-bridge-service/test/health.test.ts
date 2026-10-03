import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, statusFor } from "../src/health.ts";

const now = 1_000_000_000;
const dev = (id: string, domain: string, ageMs = 0) => ({ deviceId: id, deviceType: "x", domain, ts: now - ageMs, values: {} });

test("domain health counts offline and serious alarms, not minor ones", () => {
  const s = summarize(
    [dev("a", "water"), dev("b", "water"), dev("c", "water", 60 * 60_000), dev("d", "water"), dev("e", "lighting")],
    [{ deviceId: "a", alarmType: "Leak", severity: "CRITICAL" }, { deviceId: "b", alarmType: "Turbidity", severity: "MINOR" }],
    now,
  );
  const water = s.domains.find((d) => d.domain === "water")!;
  assert.equal(water.total, 4);
  assert.equal(water.healthy, 2); // a = critical, c = offline
  assert.equal(water.healthPct, 50);
  assert.equal(water.status, "Critical");
  assert.equal(s.overallScore, 60);
  assert.equal(s.statusCounts.Operational, 1);
});

test("status thresholds", () => {
  assert.equal(statusFor(98), "Operational");
  assert.equal(statusFor(86), "Moderate");
  assert.equal(statusFor(72), "Attention");
  assert.equal(statusFor(40), "Critical");
});
