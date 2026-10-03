import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/csv.ts";

test("parses typed values, location and quoted cells", () => {
  const { records, errors } = parseCsv([
    "deviceId,deviceType,ts,lat,lon,zone,pm25,status,note",
    'AQ-1,Air Quality Station,2026-10-02T10:00:00Z,28.6,77.2,Saket,41.5,true,"hello, world"',
    "AQ-2,,,,,,12,,",
    ",x,,,,,1,,",
    "AQ-3,1,2",
  ].join("\n"));
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].location, { lat: 28.6, lon: 77.2 });
  assert.deepEqual(records[0].values, { pm25: 41.5, status: true, note: "hello, world" });
  assert.equal(records[1].deviceType, undefined);
  assert.deepEqual(errors.map((e) => e.line), [4, 5]);
});
