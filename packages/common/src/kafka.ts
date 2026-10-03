import { Kafka, logLevel, Partitioners, type Producer, type Consumer } from "kafkajs";
import { common } from "./config.ts";
import { logger } from "./logger.ts";
import { Envelope, eventKey, type EventEnvelope } from "./envelope.ts";
import { Topics } from "./topics.ts";
import { NonRetryableError, sleep } from "./errors.ts";
import { getRedis } from "./redis.ts";
import { onShutdown } from "./lifecycle.ts";

let kafka: Kafka | undefined;
let producer: Producer | undefined;
let producerReady: Promise<void> | undefined;

export function getKafka(): Kafka {
  if (!kafka) {
    kafka = new Kafka({
      clientId: common.serviceName(),
      brokers: common.kafkaBrokers(),
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 10 },
    });
  }
  return kafka;
}

/** Shared idempotent producer (one per process). */
export async function getProducer(): Promise<Producer> {
  if (!producer) {
    producer = getKafka().producer({
      idempotent: true,
      maxInFlightRequests: 5,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    producerReady = producer.connect();
    onShutdown(async () => { await producer?.disconnect(); });
  }
  await producerReady;
  return producer;
}

/** Publish envelopes to one topic, keyed by tenant + entity so one asset's events stay ordered. */
export async function publish(topic: string, events: EventEnvelope | EventEnvelope[]): Promise<void> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return;
  const p = await getProducer();
  await p.send({
    topic,
    messages: list.map((e) => ({
      key: eventKey(e),
      value: JSON.stringify(e),
      headers: { "event-type": e.type, "tenant-id": e.tenantId, source: e.source },
    })),
  });
}

export interface ConsumerOptions<T> {
  groupId: string;
  topics: string[];
  handler: (event: EventEnvelope<T>, meta: { topic: string; partition: number; offset: string }) => Promise<void>;
  /** Attempts before the message goes to the dead-letter topic. */
  maxRetries?: number;
  /** Skip events whose eventId this group already processed (Redis, 24 h). */
  idempotent?: boolean;
  fromBeginning?: boolean;
  /** Optional filter evaluated before the handler (e.g. ignore our own events). */
  accept?: (event: EventEnvelope<T>) => boolean;
}

/**
 * Consumer with validation, idempotency, retries with exponential backoff and a dead-letter topic.
 * A handler error never blocks the partition: after maxRetries the event is parked in scaas.dlq.<group>.
 */
export async function runConsumer<T = unknown>(opts: ConsumerOptions<T>): Promise<Consumer> {
  const maxRetries = opts.maxRetries ?? 3;
  const idem = opts.idempotent ?? true;
  const consumer = getKafka().consumer({ groupId: opts.groupId, sessionTimeout: 30000 });
  await consumer.connect();
  for (const topic of opts.topics) {
    await consumer.subscribe({ topic, fromBeginning: opts.fromBeginning ?? false });
  }
  const redis = idem ? getRedis() : undefined;
  const dlqTopic = Topics.dlq(opts.groupId);

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const meta = { topic, partition, offset: message.offset };
      const rawValue = message.value?.toString("utf8") ?? "";
      let event: EventEnvelope<T>;
      try {
        event = Envelope.parse(JSON.parse(rawValue)) as EventEnvelope<T>;
      } catch (err) {
        await deadLetter(dlqTopic, meta, rawValue, err, 0);
        return;
      }
      if (opts.accept && !opts.accept(event)) return;

      const idemKey = `idem:${opts.groupId}:${event.eventId}`;
      if (redis && (await redis.exists(idemKey))) return;

      let lastErr: unknown;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await opts.handler(event, meta);
          if (redis) await redis.set(idemKey, "1", "EX", 86400);
          return;
        } catch (err) {
          lastErr = err;
          if (err instanceof NonRetryableError) break;
          logger.warn({ err, attempt, eventId: event.eventId, topic }, "handler failed, retrying");
          await sleep(250 * 2 ** (attempt - 1));
        }
      }
      await deadLetter(dlqTopic, meta, rawValue, lastErr, maxRetries);
    },
  });
  onShutdown(async () => { await consumer.disconnect(); });
  logger.info({ groupId: opts.groupId, topics: opts.topics }, "consumer started");
  return consumer;
}

async function deadLetter(
  dlqTopic: string,
  meta: { topic: string; partition: number; offset: string },
  payload: string,
  err: unknown,
  attempts: number,
): Promise<void> {
  const error = err instanceof Error ? err.message : String(err);
  logger.error({ ...meta, error, dlqTopic }, "event moved to dead-letter topic");
  const p = await getProducer();
  await p.send({
    topic: dlqTopic,
    messages: [{
      key: `${meta.topic}:${meta.partition}:${meta.offset}`,
      value: JSON.stringify({ ...meta, attempts, error, failedAt: new Date().toISOString(), payload }),
    }],
  });
}
