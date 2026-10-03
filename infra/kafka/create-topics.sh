#!/bin/bash
# Creates the SCaaS topics (idempotent). ThingsBoard creates its own tb_* topics automatically.
set -euo pipefail
BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka:9092}"
KT=/opt/kafka/bin/kafka-topics.sh
PARTITIONS="${TOPIC_PARTITIONS:-6}"
DAY=86400000

until $KT --bootstrap-server "$BOOTSTRAP" --list >/dev/null 2>&1; do echo "waiting for kafka..."; sleep 3; done

create() { # name retention_ms
  $KT --bootstrap-server "$BOOTSTRAP" --create --if-not-exists --topic "$1" \
      --partitions "$PARTITIONS" --replication-factor 1 --config retention.ms="$2" >/dev/null
  echo "topic $1 (retention $(( $2 / DAY )) d)"
}

create scaas.raw.telemetry            $((3 * DAY))
create scaas.raw.external             $((3 * DAY))
create scaas.normalized.observations  $((7 * DAY))
create scaas.alerts                   $((14 * DAY))
create scaas.incidents                $((30 * DAY))
create scaas.sla                      $((30 * DAY))
create scaas.workorders               $((30 * DAY))
create scaas.notifications.outbox     $((7 * DAY))
create scaas.audit                    $((90 * DAY))
for g in normalizer tb-bridge tb-bridge-alarms incident-service sla-workorder-service notification-service audit-service correlation-observations correlation-alarms; do
  create "scaas.dlq.$g" $((30 * DAY))
done
echo "SCaaS topics ready"
