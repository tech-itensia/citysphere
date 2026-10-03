import {
  createApp, listen, runConsumer, publish, makeEvent, stableId, Topics, inc, logger, waitFor, getRedis, tkey, DEVMAP,
  type EventEnvelope, type DeviceMapEntry,
} from "@scaas/common";
import { normalize, applyRegistry } from "./normalize.ts";

const redis = getRedis();

/** Registry entry for a device (written by asset-service); a missing or broken entry never blocks the data path. */
async function registryEntry(tenantId: string, deviceId: string): Promise<DeviceMapEntry | undefined> {
  try {
    const v = await redis.hget(tkey(tenantId, DEVMAP), deviceId);
    return v ? (JSON.parse(v) as DeviceMapEntry) : undefined;
  } catch { return undefined; }
}

const app = createApp();

await waitFor("kafka", () => runConsumer({
  groupId: "normalizer",
  topics: [Topics.rawTelemetry, Topics.rawExternal],
  handler: async (event: EventEnvelope<any>) => {
    const base = normalize(event);
    const obs = applyRegistry(base, await registryEntry(event.tenantId, base.deviceId));
    if (!obs) { inc("normalizer_dropped_total", { tenant: event.tenantId, reason: "decommissioned" }); return; }
    await publish(Topics.observations, makeEvent({
      eventId: stableId(event.eventId, "normalized"),
      type: "observation.recorded",
      tenantId: event.tenantId,
      source: event.source,
      entity: { type: "DEVICE", id: obs.deviceId, name: obs.deviceId },
      occurredAt: obs.ts,
      correlationId: event.eventId,
      data: obs,
    }));
    inc("normalizer_observations_total", { tenant: event.tenantId, origin: event.source });
  },
}));

await listen(app);
logger.info("normalizer-service ready");
