import { z } from "zod";
import { uuidv7 } from "./ids.ts";

/** One envelope for every event on the platform. Key = `${tenantId}:${entity.id}`. */
export const EntityRef = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  name: z.string().optional(),
});

export const Envelope = z.object({
  eventId: z.string().min(1),
  type: z.string().min(1),
  version: z.number().int().positive().default(1),
  tenantId: z.string().min(1),
  source: z.string().min(1),
  entity: EntityRef.optional(),
  occurredAt: z.string().min(1),
  correlationId: z.string().optional(),
  data: z.unknown(),
});

export interface EntityRefT { type: string; id: string; name?: string }

export interface EventEnvelope<T = unknown> {
  eventId: string;
  type: string;
  version: number;
  tenantId: string;
  source: string;
  entity?: EntityRefT;
  occurredAt: string;
  correlationId?: string;
  data: T;
}

export function makeEvent<T>(input: {
  type: string;
  tenantId: string;
  source: string;
  data: T;
  entity?: EntityRefT;
  correlationId?: string;
  occurredAt?: string | number | Date;
  eventId?: string;
}): EventEnvelope<T> {
  return {
    eventId: input.eventId ?? uuidv7(),
    type: input.type,
    version: 1,
    tenantId: input.tenantId,
    source: input.source,
    entity: input.entity,
    occurredAt: toIso(input.occurredAt ?? Date.now()),
    correlationId: input.correlationId,
    data: input.data,
  };
}

export function toIso(v: string | number | Date): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  const asNum = Number(v);
  if (v.trim() !== "" && Number.isFinite(asNum)) return new Date(asNum).toISOString();
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${v}`);
  return d.toISOString();
}

export function eventKey(e: { tenantId: string; entity?: { id: string } }): string {
  return `${e.tenantId}:${e.entity?.id ?? "_"}`;
}
