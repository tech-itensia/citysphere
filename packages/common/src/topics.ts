/** Kafka topic catalogue (see docs/kafka-contract.md). */
export const Topics = {
  rawTelemetry: "scaas.raw.telemetry",
  rawExternal: "scaas.raw.external",
  observations: "scaas.normalized.observations",
  alerts: "scaas.alerts",
  incidents: "scaas.incidents",
  sla: "scaas.sla",
  workOrders: "scaas.workorders",
  notifications: "scaas.notifications.outbox",
  audit: "scaas.audit",
  assets: "scaas.assets",
  dlq: (consumerGroup: string) => `scaas.dlq.${consumerGroup}`,
} as const;
