import { Redis } from "ioredis";
import { common } from "./config.ts";
import { onShutdown } from "./lifecycle.ts";

let client: Redis | undefined;

/** Shared Redis client. Keys are always tenant-prefixed: t:{tenantId}:... */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(common.redisUrl(), { maxRetriesPerRequest: 3, lazyConnect: false });
    onShutdown(async () => { await client?.quit(); });
  }
  return client;
}

export const tkey = (tenantId: string, ...parts: string[]) => ["t", tenantId, ...parts].join(":");
