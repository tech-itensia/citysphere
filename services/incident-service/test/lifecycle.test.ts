import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStatus, mapSeverity, isDuplicate, TransitionError } from "../src/lifecycle.ts";

test("happy path New -> Closed", () => {
  let s = nextStatus("New", "acknowledge");
  s = nextStatus(s, "assign");
  s = nextStatus(s, "start");
  s = nextStatus(s, "resolve");
  s = nextStatus(s, "verify");
  s = nextStatus(s, "close");
  assert.equal(s, "Closed");
});

test("illegal transitions are refused", () => {
  assert.throws(() => nextStatus("Closed", "resolve"), TransitionError);
  assert.throws(() => nextStatus("New", "start"), TransitionError);
  assert.throws(() => nextStatus("Closed", "escalate"), TransitionError);
});

test("escalate keeps status; reassign keeps In Progress; reopen from Resolved", () => {
  assert.equal(nextStatus("Assigned", "escalate"), "Assigned");
  assert.equal(nextStatus("In Progress", "assign"), "In Progress");
  assert.equal(nextStatus("Resolved", "reopen"), "Reopened");
});

test("severity mapping and duplicate window", () => {
  assert.equal(mapSeverity("MAJOR"), "High");
  assert.equal(mapSeverity("WARNING"), "Low");
  const ex = { deviceId: "WB-1", category: "waste", status: "New" as const, createdAt: 0 };
  assert.equal(isDuplicate(ex, { deviceId: "WB-1", category: "waste", at: 10 * 60_000 }), true);
  assert.equal(isDuplicate(ex, { deviceId: "WB-1", category: "waste", at: 20 * 60_000 }), false);
  assert.equal(isDuplicate({ ...ex, status: "Closed" }, { deviceId: "WB-1", category: "waste", at: 1 }), false);
});
