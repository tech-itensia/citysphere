# Kafka contract

All SCaaS events share one JSON envelope. The message **key** is `${tenantId}:${entity.id}`, so the events of one device or incident stay in order within a partition.

```json
{
  "eventId": "0192f3c4-7b1e-7c2a-9d3e-1f2a3b4c5d6e",
  "type": "telemetry.received",
  "version": 1,
  "tenantId": "delhi",
  "source": "ingest-api",
  "entity": { "type": "DEVICE", "id": "WB-CONNAU-01" },
  "occurredAt": "2026-10-02T11:20:00.000Z",
  "correlationId": "optional",
  "data": { }
}
```

| Topic | Producer | Event types | Consumers | Retention |
| --- | --- | --- | --- | --- |
| `scaas.raw.telemetry` | ingest-service, ThingsBoard rule chain, trusted producers | `telemetry.received` | normalizer | 3 d |
| `scaas.raw.external` | connector-service | `external.observed` | normalizer | 3 d |
| `scaas.normalized.observations` | normalizer | `observation.recorded` | tb-bridge, correlation, api-gateway (SSE) | 7 d |
| `scaas.alerts` | ThingsBoard rule chain, correlation-service | `alarm.raised`, `alarm.cleared` | incident-service, tb-bridge, correlation | 14 d |
| `scaas.incidents` | incident-service | `incident.created`, `incident.updated` | sla-workorder, notification, api-gateway | 30 d |
| `scaas.sla` | sla-workorder-service | `sla.amber`, `sla.breached` | notification, api-gateway | 30 d |
| `scaas.workorders` | sla-workorder-service | `workorder.created`, `workorder.updated` | notification, api-gateway | 30 d |
| `scaas.notifications.outbox` | any service | `notification.requested` | notification | 7 d |
| `scaas.audit` | api-gateway, all services | `audit.recorded` | audit-service | 90 d |
| `scaas.assets` | asset-service | `device.registered`, `device.updated`, `device.provisioned`, `device.status.changed` | (any; audit, analytics) | 30 d |
| `scaas.dlq.<consumer-group>` | any consumer after 3 failed attempts | original payload + error | IT/Ops replay | 30 d |

## Posting device data

There are three supported ways in. All three end on `scaas.raw.telemetry` and flow through the same pipeline.

1. **HTTP via ingest-service (recommended for integrators).** `POST /v1/telemetry` with an `x-api-key` tenant key. The service validates, rate-limits and publishes to Kafka. See `docs/ingest-api.yaml`.
2. **Directly to Kafka (trusted internal producers only).** Produce to `scaas.raw.telemetry` with the envelope above, `type: "telemetry.received"`, and `data` shaped like an ingest record:

   ```json
   { "deviceId": "WN-KAROLB-02", "deviceType": "Water Node", "ts": 1790000000000,
     "values": { "pressureBar": 2.9, "flowLpm": 410 }, "zone": "Karol Bagh",
     "location": { "lat": 28.65, "lon": 77.19 } }
   ```

   Use key `delhi:WN-KAROLB-02`. Producers must authenticate to Kafka (SASL/mTLS in staging and production) and be granted write ACLs on this topic only.
3. **Natively to ThingsBoard** (MQTT `v1/devices/me/telemetry` or HTTP `/api/v1/{token}/telemetry`). The tenant's root rule chain exports the data to Kafka with `source: "thingsboard"`.

## Loop prevention

tb-bridge pushes Kafka data into ThingsBoard tagged with `ingestSource: "kafka"`. The rule-chain filter `SCaaS not from bridge` drops tagged messages before the Kafka export, so data never circulates back. tb-bridge also skips observations whose `origin` is `thingsboard`.

## Reliability rules

- Consumers are idempotent: the processed `eventId`s are kept in Redis for 24 h per consumer group.
- A failing handler is retried 3 times with exponential backoff (250 ms, 500 ms, 1 s), then the message goes to `scaas.dlq.<group>`. Validation errors go there immediately.
- Replay: reset the consumer group's offset (Kafka UI → Consumers, or `kafka-consumer-groups.sh --reset-offsets`).
