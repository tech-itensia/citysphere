import { makeEvent } from "./envelope.ts";
import { publish } from "./kafka.ts";
import { Topics } from "./topics.ts";
import { common } from "./config.ts";
import { logger } from "./logger.ts";

/** Fire-and-forget audit event; audit-service persists it append-only. */
export async function audit(input: {
  tenantId: string;
  actor: string;
  action: string;
  resource: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  try {
    await publish(Topics.audit, makeEvent({
      type: "audit.recorded",
      tenantId: input.tenantId,
      source: common.serviceName(),
      entity: { type: "RESOURCE", id: input.resource },
      data: { actor: input.actor, action: input.action, resource: input.resource, ...input.data },
    }));
  } catch (err) {
    logger.error({ err, ...input }, "failed to publish audit event");
  }
}
