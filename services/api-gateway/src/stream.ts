import { getKafka, Topics, logger, onShutdown, type EventEnvelope } from "@scaas/common";
import { hostname } from "node:os";

type Client = { tenantId: string; roles: string[]; send: (event: string, data: unknown) => void };
const clients = new Set<Client>();
const lastTwin = new Map<string, number>();

export function addClient(c: Client): () => void {
  clients.add(c);
  return () => clients.delete(c);
}
export const clientCount = () => clients.size;

const NAME: Record<string, string> = {
  [Topics.incidents]: "incident",
  [Topics.sla]: "sla",
  [Topics.workOrders]: "workorder",
  [Topics.alerts]: "alert",
  [Topics.observations]: "twin",
};

/** One consumer group per gateway replica: every replica fans out every event to its own SSE clients. */
export async function startStream(): Promise<void> {
  const consumer = getKafka().consumer({ groupId: `gateway-sse-${hostname()}` });
  await consumer.connect();
  for (const topic of Object.keys(NAME)) await consumer.subscribe({ topic, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }: any) => {
      if (!clients.size) return;
      let e: EventEnvelope<any>;
      try { e = JSON.parse(message.value.toString()); } catch { return; }
      if (topic === Topics.observations) {
        const k = `${e.tenantId}:${e.entity?.id}`;
        const now = Date.now();
        if (now - (lastTwin.get(k) ?? 0) < 5000) return; // at most one twin update per device per 5 s
        lastTwin.set(k, now);
      }
      for (const c of clients) {
        if (c.tenantId !== e.tenantId) continue;
        if (c.roles.length === 1 && c.roles[0] === "citizen") continue;
        c.send(NAME[topic], { type: e.type, entity: e.entity, occurredAt: e.occurredAt, data: e.data });
      }
    },
  });
  onShutdown(async () => { await consumer.disconnect(); });
  logger.info("SSE fan-out consumer started");
}
