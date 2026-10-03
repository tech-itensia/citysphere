import { getRedis, tkey, type Observation } from "@scaas/common";
import { deviceTypeByName } from "@scaas/thingsboard";
import type { AlarmState, TwinDevice } from "./health.ts";

const redis = getRedis();

/** Latest state per device in one Redis hash per tenant: fast map/dashboard reads without ThingsBoard calls. */
export async function updateTwin(tenantId: string, obs: Observation): Promise<void> {
  const key = tkey(tenantId, "twin");
  const prev = await redis.hget(key, obs.deviceId);
  const old: TwinDevice | undefined = prev ? JSON.parse(prev) : undefined;
  if (old && old.ts > obs.ts) return; // late, out-of-order observation
  const next: TwinDevice = {
    deviceId: obs.deviceId,
    deviceType: obs.deviceType,
    domain: deviceTypeByName(obs.deviceType)?.domain ?? "generic",
    zone: obs.zone ?? old?.zone,
    lat: obs.location?.lat ?? old?.lat,
    lon: obs.location?.lon ?? old?.lon,
    ts: obs.ts,
    values: { ...(old?.values ?? {}), ...obs.values },
  };
  await redis.hset(key, obs.deviceId, JSON.stringify(next));
}

export async function listTwin(tenantId: string): Promise<TwinDevice[]> {
  const all = await redis.hgetall(tkey(tenantId, "twin"));
  return Object.values(all).map((v) => JSON.parse(v as string) as TwinDevice);
}

export async function getTwin(tenantId: string, deviceId: string): Promise<TwinDevice | undefined> {
  const v = await redis.hget(tkey(tenantId, "twin"), deviceId);
  return v ? JSON.parse(v) : undefined;
}

export async function setAlarm(tenantId: string, a: AlarmState, active: boolean): Promise<void> {
  const field = `${a.deviceId}|${a.alarmType}`;
  if (active) await redis.hset(tkey(tenantId, "alarms"), field, a.severity);
  else await redis.hdel(tkey(tenantId, "alarms"), field);
}

export async function listAlarms(tenantId: string): Promise<AlarmState[]> {
  const all = await redis.hgetall(tkey(tenantId, "alarms"));
  return Object.entries(all).map(([field, severity]) => {
    const [deviceId, alarmType] = field.split("|");
    return { deviceId, alarmType, severity: severity as string };
  });
}
