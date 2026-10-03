import { test } from "node:test";
import assert from "node:assert/strict";
import { deadlines, rag, DEFAULT_POLICIES, checkpoints, parseCheckpoint, woNext } from "../src/sla.ts";

test("critical incident: response due in 5 min, amber at 75%", () => {
  const d = deadlines(0, DEFAULT_POLICIES.Critical);
  assert.equal(d.responseDue, 5 * 60_000);
  assert.equal(d.responseAmber, 225_000);
  assert.equal(d.resolutionDue, 4 * 3600_000);
});

test("RAG states", () => {
  assert.equal(rag(100, 200, 300), "green");
  assert.equal(rag(250, 200, 300), "amber");
  assert.equal(rag(300, 200, 300), "red");
  assert.equal(rag(999, 200, 300, 280), "met");
  assert.equal(rag(999, 200, 300, 320), "met_late");
});

test("checkpoint members round-trip", () => {
  const cps = checkpoints("delhi", "abc", deadlines(0, DEFAULT_POLICIES.High));
  assert.equal(cps.length, 4);
  assert.deepEqual(parseCheckpoint(cps[1][1]), { tenantId: "delhi", incidentId: "abc", clock: "response", level: "red" });
});

test("work order lifecycle", () => {
  let s = woNext("Open", "assign");
  s = woNext(s, "accept");
  s = woNext(s, "start");
  s = woNext(s, "hold");
  s = woNext(s, "resume");
  s = woNext(s, "complete");
  s = woNext(s, "verify");
  assert.equal(woNext(s, "close"), "Closed");
  assert.throws(() => woNext("Closed", "start"));
});
