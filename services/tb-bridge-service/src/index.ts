import {
  createApp, listen, runConsumer, ctx, Topics, inc, logger, waitFor, HttpError,
  type EventEnvelope, type Observation, type AlarmData,
} from "@scaas/common";
import { pushTelemetry, tbDevice } from "./tb.ts";
import { updateTwin, listTwin, getTwin, setAlarm, listAlarms } from "./twin.ts";
import { summarize } from "./health.ts";

const app = createApp({ internalOnly: true });

// Kafka -> ThingsBoard (skip data that came from ThingsBoard itself) + twin cache for every observation.
await waitFor("kafka", () => runConsumer<Observation>({
  groupId: "tb-bridge",
  topics: [Topics.observations],
  handler: async (event: EventEnvelope<Observation>) => {
    await updateTwin(event.tenantId, event.data);
    if (event.data.origin !== "thingsboard") {
      await pushTelemetry(event.tenantId, event.data);
      inc("tb_bridge_pushed_total", { tenant: event.tenantId });
    }
  },
}));

// Alarm state for twin health.
await runConsumer<AlarmData>({
  groupId: "tb-bridge-alarms",
  topics: [Topics.alerts],
  handler: async (event: EventEnvelope<AlarmData>) => {
    const d = event.data;
    await setAlarm(event.tenantId, { deviceId: d.deviceId, alarmType: d.alarmType, severity: d.severity }, event.type === "alarm.raised");
  },
});

// ---------------------------------------------------------------- twin read API (via api-gateway)
app.get("/twin/devices", async (req: any) => {
  const c = ctx(req);
  const { type, zone, domain } = req.query ?? {};
  const [devices, alarms] = await Promise.all([listTwin(c.tenantId), listAlarms(c.tenantId)]);
  const alarmed = new Map<string, string[]>();
  for (const a of alarms) alarmed.set(a.deviceId, [...(alarmed.get(a.deviceId) ?? []), `${a.severity}:${a.alarmType}`]);
  const staleMs = 15 * 60_000;
  return devices
    .filter((d) => (!type || d.deviceType === type) && (!zone || d.zone === zone) && (!domain || d.domain === domain))
    .map((d) => ({ ...d, online: Date.now() - d.ts < staleMs, alarms: alarmed.get(d.deviceId) ?? [] }));
});

app.get("/twin/summary", async (req: any) => {
  const c = ctx(req);
  const [devices, alarms] = await Promise.all([listTwin(c.tenantId), listAlarms(c.tenantId)]);
  return summarize(devices, alarms);
});

app.get("/twin/devices/:deviceId", async (req: any) => {
  const c = ctx(req);
  const state = await getTwin(c.tenantId, req.params.deviceId);
  const { tb, device } = await tbDevice(c.tenantId, req.params.deviceId);
  if (!state && !device) throw new HttpError(404, "Device not found");
  const [attributes, alarms] = device ? await Promise.all([
    tb.get(`/api/plugins/telemetry/DEVICE/${device.id.id}/values/attributes/SERVER_SCOPE`),
    tb.get(`/api/alarm/DEVICE/${device.id.id}`, { pageSize: 20, page: 0, searchStatus: "ACTIVE", sortProperty: "createdTime", sortOrder: "DESC" }),
  ]) : [[], { data: [] }];
  return { state, tbDeviceId: device?.id.id, profile: device?.type, attributes, activeAlarms: alarms.data };
});

/** History for the twin's 24-48 h view: ?keys=pm25,aqi&hours=24 */
app.get("/twin/devices/:deviceId/history", async (req: any) => {
  const c = ctx(req);
  const hours = Math.min(Number(req.query?.hours ?? 24), 48);
  const keys = String(req.query?.keys ?? "");
  const { tb, device } = await tbDevice(c.tenantId, req.params.deviceId);
  if (!device) throw new HttpError(404, "Device not found in ThingsBoard");
  const endTs = Date.now();
  const keyList = keys || (await tb.get<string[]>(`/api/plugins/telemetry/DEVICE/${device.id.id}/keys/timeseries`))
    .filter((k) => k !== "ingestSource").join(",");
  if (!keyList) return {};
  return tb.get(`/api/plugins/telemetry/DEVICE/${device.id.id}/values/timeseries`, {
    keys: keyList, startTs: endTs - hours * 3600_000, endTs, limit: 5000, agg: "NONE", orderBy: "ASC", useStrictDataTypes: true,
  });
});

await listen(app);
logger.info("tb-bridge-service ready");
