import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFleet, sample, rng } from "../src/fleet.ts";
import { SCENARIOS } from "../src/scenarios.ts";
import { CITIES } from "../src/cities.ts";

test("fleet is deterministic and covers every type", () => {
  const a = buildFleet(CITIES.delhi), b = buildFleet(CITIES.delhi);
  assert.deepEqual(a.map((d) => d.id), b.map((d) => d.id));
  assert.equal(new Set(a.map((d) => d.id)).size, a.length);
  assert.deepEqual([...new Set(a.map((d) => d.kind))].sort(), ["AQ", "AT", "DR", "ER", "PK", "PM", "RG", "SL", "TJ", "VH", "WB", "WN"]);
});

test("street lights are on at night and off at noon", () => {
  const sl = buildFleet(CITIES.delhi).find((d) => d.kind === "SL")!;
  const r = rng(1);
  assert.equal(sample(sl, new Date(2026, 9, 2, 22, 0).getTime(), r).status, "ON");
  assert.equal(sample(sl, new Date(2026, 9, 2, 12, 0).getTime(), r).status, "OFF");
});

test("scenario override applies, then expires", () => {
  const fleet = buildFleet(CITIES.delhi);
  const now = new Date(2026, 9, 2, 12, 0).getTime();
  const ids = SCENARIOS.find((s) => s.name === "water-main-break")!.run(fleet, now, (xs) => xs[0]);
  assert.equal(ids.length, 3);
  const wn = fleet.find((d) => d.id === ids[0])!;
  assert.equal(sample(wn, now + 60_000, rng(2)).pressureBar, 0.8);
  assert.notEqual(sample(wn, now + 21 * 60_000, rng(2)).pressureBar, 0.8);
});
