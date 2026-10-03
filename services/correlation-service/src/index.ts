import {
  createApp, listen, runConsumer, publish, makeEvent, stableId, Topics, logger, waitFor, getRedis, tkey, inc,
  type EventEnvelope, type Observation, type AlarmData,
} from "@scaas/common";
import { Correlator, type Correlated } from "./rules.ts";

const app = createApp({ internalOnly: true });
const correlator = new Correlator();
const redis = getRedis();
const CONTEXT_TYPES = new Set(["Weather Feed", "City Event Feed"]);

async function zoneOf(tenantId: string, deviceId: string): Promise<string | undefined> {
  const v = await redis.hget(tkey(tenantId, "twin"), deviceId);
  return v ? JSON.parse(v).zone : undefined;
}

async function raise(tenantId: string, c: Correlated) {
  const now = Date.now();
  const alarmId = stableId(tenantId, c.ruleId, c.deviceId, Math.floor(now / 3600_000));
  await publish(Topics.alerts, makeEvent<AlarmData>({
    eventId: stableId(alarmId, "raised"),
    type: "alarm.raised",
    tenantId,
    source: "correlation",
    entity: { type: "DEVICE", id: c.deviceId },
    data: {
      alarmId, alarmType: c.alarmType, severity: c.severity, status: "ACTIVE_UNACK", deviceId: c.deviceId,
      deviceType: c.deviceType, startTs: now, details: { ruleId: c.ruleId, zone: c.zone, evidence: c.evidence },
    },
  }));
  inc("correlations_total", { tenant: tenantId, rule: c.ruleId });
  logger.info({ tenantId, rule: c.ruleId, evidence: c.evidence }, "correlated alert raised");
}

await waitFor("kafka", () => runConsumer<Observation>({
  groupId: "correlation-observations",
  topics: [Topics.observations],
  idempotent: false,
  accept: (e) => CONTEXT_TYPES.has(e.data?.deviceType),
  handler: async (e) => {
    for (const c of correlator.add(e.tenantId, { kind: "observation", at: e.data.ts, deviceId: e.data.deviceId, deviceType: e.data.deviceType, zone: e.data.zone, values: e.data.values })) {
      await raise(e.tenantId, c);
    }
  },
}));

await runConsumer<AlarmData>({
  groupId: "correlation-alarms",
  topics: [Topics.alerts],
  accept: (e) => e.source !== "correlation",
  handler: async (e: EventEnvelope<AlarmData>) => {
    const a = e.data;
    const signal = {
      kind: "alarm" as const, at: Date.now(), deviceId: a.deviceId, deviceType: a.deviceType, alarmType: a.alarmType,
      severity: e.type === "alarm.cleared" ? "CLEARED" : a.severity, zone: await zoneOf(e.tenantId, a.deviceId),
    };
    for (const c of correlator.add(e.tenantId, signal)) await raise(e.tenantId, c);
  },
});

await listen(app);
logger.info("correlation-service ready");
