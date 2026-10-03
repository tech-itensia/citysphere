import {
  createApp, listen, runConsumer, publish, makeEvent, stableId, Topics, inc, logger, waitFor,
  type EventEnvelope,
} from "@scaas/common";
import { normalize } from "./normalize.ts";

const app = createApp();

await waitFor("kafka", () => runConsumer({
  groupId: "normalizer",
  topics: [Topics.rawTelemetry, Topics.rawExternal],
  handler: async (event: EventEnvelope<any>) => {
    const obs = normalize(event);
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
