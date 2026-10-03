import { test } from "node:test";
import assert from "node:assert/strict";
import { nextStatus, mapSeverity, isDuplicate, allowedActions, TransitionError, isOpen } from "../src/lifecycle.ts";

test("happy path follows the plan's state machine", () => {
  let s = nextStatus("New", "acknowledge");
  assert.equal(s, "Acknowledged");
  s = nextStatus(s, "assign");
  s = nextStatus(s, "start");
  assert.equal(s, "In Progress");
  s = nextStatus(s, "complete");
  assert.equal(s, "Resolution Pending");
  s = nextStatus(s, "confirm");
  assert.equal(s, "Resolved");
  s = nextStatus(s, "close");
  assert.equal(s, "Closed");
});

test("escalation: flag before pickup, Escalated state after, resume returns to In Progress", () => {
  assert.equal(nextStatus("New", "escalate"), "New");
  assert.equal(nextStatus("Assigned", "escalate"), "Escalated");
  assert.equal(nextStatus("In Progress", "escalate"), "Escalated");
  assert.equal(nextStatus("Escalated", "start"), "In Progress");
  assert.equal(nextStatus("Escalated", "assign"), "Assigned");
});

test("reopen and reassign", () => {
  assert.equal(nextStatus("Resolution Pending", "reopen"), "In Progress");
  assert.equal(nextStatus("Resolved", "reopen"), "In Progress");
  assert.equal(nextStatus("In Progress", "assign"), "In Progress");
});

test("dismiss only before work starts; closed is terminal", () => {
  assert.equal(nextStatus("New", "dismiss"), "Closed");
  assert.throws(() => nextStatus("In Progress", "dismiss"), TransitionError);
  assert.throws(() => nextStatus("Closed", "reopen"), TransitionError);
  assert.throws(() => nextStatus("Closed", "escalate"), TransitionError);
  assert.throws(() => nextStatus("New", "close"), TransitionError);
  assert.throws(() => nextStatus("New", "complete"), TransitionError);
});

test("allowed actions depend on role", () => {
  assert.deepEqual(allowedActions("Resolution Pending", ["citizen"]), ["confirm", "reopen"]);
  assert.deepEqual(allowedActions("Assigned", ["field_tech"]), ["start", "complete"]);
  assert.ok(allowedActions("New", ["operator"]).includes("dismiss"));
  assert.deepEqual(allowedActions("Closed", ["super_admin"]), []);
});

test("open statuses, severity mapping and duplicate window", () => {
  assert.equal(isOpen("Resolution Pending"), true);
  assert.equal(isOpen("Resolved"), false);
  assert.equal(mapSeverity("MAJOR"), "High");
  assert.equal(mapSeverity("WARNING"), "Low");
  const ex = { deviceId: "WB-1", category: "waste", status: "New" as const, createdAt: 0 };
  assert.equal(isDuplicate(ex, { deviceId: "WB-1", category: "waste", at: 10 * 60_000 }), true);
  assert.equal(isDuplicate(ex, { deviceId: "WB-1", category: "waste", at: 20 * 60_000 }), false);
  assert.equal(isDuplicate({ ...ex, status: "Closed" }, { deviceId: "WB-1", category: "waste", at: 1 }), false);
});
