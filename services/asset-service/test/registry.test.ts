import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDeviceStatus, LifecycleError, nearestZone, validateImport, parseCsv, connectionInfo } from "../src/registry.ts";

test("device lifecycle happy path", () => {
  assert.equal(nextDeviceStatus("Discovered", "register"), "Registered");
  assert.equal(nextDeviceStatus("Registered", "provision"), "Provisioned");
  assert.equal(nextDeviceStatus("Provisioned", "commission"), "Active");
  assert.equal(nextDeviceStatus("Active", "maintenance"), "Maintenance");
  assert.equal(nextDeviceStatus("Maintenance", "restore"), "Active");
  assert.equal(nextDeviceStatus("Active", "decommission"), "Decommissioned");
});

test("re-provisioning an active device keeps it active", () => {
  assert.equal(nextDeviceStatus("Active", "provision"), "Active");
});

test("illegal transitions are refused", () => {
  assert.throws(() => nextDeviceStatus("Decommissioned", "commission"), LifecycleError);
  assert.throws(() => nextDeviceStatus("Discovered", "commission"), LifecycleError);
  assert.throws(() => nextDeviceStatus("Decommissioned", "decommission"), LifecycleError);
});

test("nearest zone within range", () => {
  const zones = [{ name: "A", lat: 28.63, lon: 77.21 }, { name: "B", lat: 28.52, lon: 77.2 }];
  assert.equal(nearestZone({ lat: 28.631, lon: 77.212 }, zones), "A");
  assert.equal(nearestZone({ lat: 12.9, lon: 77.5 }, zones), undefined);
});

test("csv parser handles quotes and CRLF", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n'), [["a", "b"], ["x, y", 'he said "hi"']]);
});

test("import validation reports every problem with its line", () => {
  const csv = [
    "deviceId,deviceType,protocol,lat,lon,criticality",
    "SL-1,Street Light,mqtt,28.6,77.2,High",
    "SL-1,Street Light,mqtt,28.6,77.2,High",
    "XX-2,Toaster,mqtt,,,",
    "WN-3,Water Node,pigeon,,,",
    "WN-4,Water Node,,95,77,",
    "WN-5,Water Node,,,,",
  ].join("\n");
  const { rows, issues } = validateImport(csv, ["Street Light", "Water Node"]);
  assert.deepEqual(rows.map((r) => r.deviceId), ["SL-1", "WN-5"]);
  assert.equal(rows[1].protocol, "http-ingest");
  assert.deepEqual(issues.map((i) => [i.line, i.field]), [[3, "deviceId"], [4, "deviceType"], [5, "protocol"], [6, "lat"]]);
});

test("missing required column", () => {
  const { issues } = validateImport("name\nx", ["Street Light"]);
  assert.equal(issues.length, 2);
});

test("connection info includes token-based endpoints only when provisioned", () => {
  const c = connectionInfo({ protocol: "mqtt", deviceId: "SL-1", token: "abc", tbHost: "localhost", ingestUrl: "http://localhost:8091", sampleKeys: ["status", "powerW"] });
  assert.equal(c.mqtt?.username, "abc");
  assert.match(c.ingest.curl, /x-api-key/);
  const d = connectionInfo({ protocol: "http-ingest", deviceId: "SL-1", tbHost: "localhost", ingestUrl: "http://x", sampleKeys: [] });
  assert.equal(d.mqtt, undefined);
});
