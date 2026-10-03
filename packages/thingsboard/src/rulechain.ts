import type { TbClient } from "./client.ts";

const MARK = "SCaaS";
const TS_NODE = "org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode";
const PROFILE_NODE = "org.thingsboard.rule.engine.profile.TbDeviceProfileNode";
const FILTER_NODE = "org.thingsboard.rule.engine.filter.TbJsFilterNode";
const TRANSFORM_NODE = "org.thingsboard.rule.engine.transform.TbTransformMsgNode";
const KAFKA_NODE = "org.thingsboard.rule.engine.kafka.TbKafkaNode";

/** TBEL: wrap device telemetry into the platform event envelope. */
export function telemetryScript(tenantId: string): string {
  const t = JSON.stringify(tenantId);
  return [
    `var out = {`,
    `  "eventId": "tb-" + metadata.deviceName + "-" + metadata.ts,`,
    `  "type": "telemetry.received", "version": 1, "tenantId": ${t}, "source": "thingsboard",`,
    `  "entity": {"type": "DEVICE", "id": metadata.deviceName, "name": metadata.deviceName},`,
    `  "occurredAt": metadata.ts,`,
    `  "data": {"deviceId": metadata.deviceName, "deviceType": metadata.deviceType, "values": msg}`,
    `};`,
    `return {msg: out, metadata: metadata, msgType: msgType};`,
  ].join("\n");
}

/** TBEL: wrap an alarm (created / updated / severity updated / cleared) into an alert envelope. */
export function alarmScript(tenantId: string): string {
  const t = JSON.stringify(tenantId);
  return [
    `var cleared = msg.cleared == true || (msg.status != null && msg.status.startsWith("CLEARED"));`,
    `var state = cleared ? "cleared" : msg.severity;`,
    `var out = {`,
    `  "eventId": "tbalarm-" + msg.id.id + "-" + state,`,
    `  "type": cleared ? "alarm.cleared" : "alarm.raised", "version": 1, "tenantId": ${t}, "source": "thingsboard",`,
    `  "entity": {"type": "DEVICE", "id": metadata.deviceName, "name": metadata.deviceName},`,
    `  "occurredAt": "" + msg.startTs,`,
    `  "data": {"alarmId": msg.id.id, "alarmType": msg.type, "severity": msg.severity, "status": msg.status,`,
    `           "deviceId": metadata.deviceName, "deviceType": metadata.deviceType, "startTs": msg.startTs, "details": msg.details}`,
    `};`,
    `return {msg: out, metadata: metadata, msgType: msgType};`,
  ].join("\n");
}

const kafkaConfig = (topic: string, keyPattern: string, servers: string) => ({
  topicPattern: topic,
  keyPattern,
  bootstrapServers: servers,
  retries: 3,
  batchSize: 16384,
  linger: 5,
  bufferMemory: 33554432,
  acks: "-1",
  keySerializer: "org.apache.kafka.common.serialization.StringSerializer",
  valueSerializer: "org.apache.kafka.common.serialization.StringSerializer",
  otherProperties: {},
  addMetadataKeyValuesAsKafkaHeaders: false,
  kafkaHeadersCharset: "UTF-8",
});

const node = (type: string, name: string, configuration: Record<string, unknown>, x: number, y: number) => ({
  type, name, debugMode: false, singletonMode: false, configurationVersion: 0, configuration,
  additionalInfo: { description: "Added by SCaaS tenant provisioning", layoutX: x, layoutY: y },
});

/**
 * Adds SCaaS export nodes to the tenant's root rule chain (idempotent):
 *   Save Timeseries --Success--> [filter: not written by tb-bridge] --True--> [envelope] --> Kafka scaas.raw.telemetry
 *   Device Profile  --Alarm *--> [alert envelope] --> Kafka scaas.alerts
 * The filter stops a loop: telemetry that tb-bridge pushed from Kafka carries ingestSource="kafka".
 */
export async function patchRootRuleChain(tb: TbClient, tenantId: string, kafkaServers: string): Promise<"patched" | "already-patched"> {
  const chains = await tb.get<{ data: Array<{ id: { id: string }; root: boolean }> }>("/api/ruleChains", { pageSize: 100, page: 0, type: "CORE" });
  const root = chains.data.find((c) => c.root);
  if (!root) throw new Error("Root rule chain not found");
  const meta = await tb.get<any>(`/api/ruleChain/${root.id.id}/metadata`);
  if (meta.nodes.some((n: { name: string }) => n.name.startsWith(MARK))) return "already-patched";

  const tsIdx = meta.nodes.findIndex((n: { type: string }) => n.type === TS_NODE);
  const profIdx = meta.nodes.findIndex((n: { type: string }) => n.type === PROFILE_NODE);
  if (tsIdx < 0) throw new Error("Save Timeseries node not found in root rule chain");

  const base = meta.nodes.length;
  const key = `${tenantId}:\${deviceName}`;
  const both = (s: string) => ({ scriptLang: "TBEL", tbelScript: s, jsScript: s });
  meta.nodes.push(
    node(FILTER_NODE, `${MARK} not from bridge`, both("return msg.ingestSource == null;"), 1100, 150),
    node(TRANSFORM_NODE, `${MARK} telemetry envelope`, both(telemetryScript(tenantId)), 1100, 250),
    node(KAFKA_NODE, `${MARK} Kafka telemetry`, kafkaConfig("scaas.raw.telemetry", key, kafkaServers), 1100, 350),
    node(TRANSFORM_NODE, `${MARK} alarm envelope`, both(alarmScript(tenantId)), 1400, 250),
    node(KAFKA_NODE, `${MARK} Kafka alerts`, kafkaConfig("scaas.alerts", key, kafkaServers), 1400, 350),
  );
  meta.connections = meta.connections ?? [];
  meta.connections.push(
    { fromIndex: tsIdx, toIndex: base, type: "Success" },
    { fromIndex: base, toIndex: base + 1, type: "True" },
    { fromIndex: base + 1, toIndex: base + 2, type: "Success" },
    { fromIndex: base + 3, toIndex: base + 4, type: "Success" },
  );
  if (profIdx >= 0) {
    for (const t of ["Alarm Created", "Alarm Updated", "Alarm Severity Updated", "Alarm Cleared"]) {
      meta.connections.push({ fromIndex: profIdx, toIndex: base + 3, type: t });
    }
  } else {
    tb.log().warn("Device Profile node not found; alarms will not be exported to Kafka");
  }
  await tb.post("/api/ruleChain/metadata", meta);
  return "patched";
}
