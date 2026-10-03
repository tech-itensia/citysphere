import { test } from "node:test";
import assert from "node:assert/strict";
import { matchRoute, allowed, tenantFromGroups, departmentsFromGroups, homeFor } from "../src/access.ts";

test("routing by prefix", () => {
  assert.equal(matchRoute("/api/incidents/123/transition?x=1")?.upstream, "INCIDENT");
  assert.equal(matchRoute("/api/work-orders")?.path, "/work-orders");
  assert.equal(matchRoute("/api/incidentsX"), undefined);
});

test("persona access", () => {
  const audit = matchRoute("/api/audit")!;
  assert.equal(allowed(["operator"], audit), false);
  assert.equal(allowed(["it_ops"], audit), true);
  assert.equal(allowed(["super_admin"], audit), true);
  assert.equal(allowed(["citizen"], matchRoute("/api/twin/devices")!), false);
  assert.equal(allowed(["citizen"], matchRoute("/api/incidents")!), true);
});

test("tenant and department from Keycloak groups", () => {
  assert.equal(tenantFromGroups(["/tenants/delhi/departments/water"]), "delhi");
  assert.deepEqual(departmentsFromGroups(["/tenants/delhi/departments/water"]), ["water"]);
  assert.equal(tenantFromGroups(["/other"]), undefined);
  assert.equal(homeFor(["operator", "analyst"]), "/command-centre");
});

import { entitled } from "../src/access.ts";

test("specific routes win over broader ones; new v2 routes", () => {
  assert.equal(matchRoute("/api/notifications/preferences")?.path, "/notifications/preferences");
  assert.equal(allowed(["citizen"], matchRoute("/api/notifications/preferences")!), true);
  assert.equal(allowed(["citizen"], matchRoute("/api/notifications")!), false);
  assert.equal(matchRoute("/api/assets/devices/SL-1/provision")?.upstream, "ASSET");
  assert.equal(allowed(["citizen"], matchRoute("/api/assets/devices")!), false);
  assert.equal(allowed(["citizen"], matchRoute("/api/advisories")!), true);
  assert.equal(allowed(["operator"], matchRoute("/api/users")!), false);
});

test("module entitlements", () => {
  const twin = matchRoute("/api/twin/devices")!;
  assert.equal(entitled(["operator"], twin, ["command_centre"]), false);
  assert.equal(entitled(["operator"], twin, ["digital_twin"]), true);
  assert.equal(entitled(["super_admin"], twin, []), true);
  assert.equal(entitled(["operator"], matchRoute("/api/incidents")!, []), true);
});
