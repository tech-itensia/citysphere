#!/usr/bin/env bash
# Collects the state of the stack into diagnostics.txt (in the project folder) for troubleshooting.
cd "$(dirname "$0")/.."
OUT=diagnostics.txt
{
  echo "### $(date)"
  echo "### docker compose ps"; docker compose ps --format "table {{.Name}}\t{{.Status}}"
  echo; echo "### ThingsBoard users + credentials"
  docker compose exec -T postgres psql -U postgres -d thingsboard -c \
    "select u.email, u.authority, c.enabled, left(c.password, 7) as hash_prefix, c.activate_token is not null as pending_activation, c.additional_info
     from tb_user u left join user_credentials c on c.user_id = u.id order by u.authority, u.email;"
  echo; echo "### SCaaS tenants"
  docker compose exec -T postgres psql -U postgres -d scaas -c "select id, status, left(coalesce(error,''),200) as error, tb_tenant_id is not null as in_tb from tenant.tenants;"
  echo; echo "### login test"
  curl -s -X POST http://localhost:8080/api/auth/login -H 'content-type: application/json' \
    -d '{"username":"sysadmin@thingsboard.org","password":"sysadmin"}' | head -c 300; echo
  for s in tb-http-transport1 tb-mqtt-transport1; do
    echo; echo "### $s - first errors"
    docker compose logs "$s" --no-log-prefix 2>&1 | grep -m15 -iE "caused by|exception|error|failed|denied" 
    echo "### $s - first 40 lines"; docker compose logs "$s" --no-log-prefix 2>&1 | head -40
  done
  echo; echo "### tb-core1 auth-related log lines"
  docker compose logs tb-core1 --no-log-prefix 2>&1 | grep -iE "auth|login|credential|sysadmin" | tail -20
  echo; echo "### tenant-service (last 30)"; docker compose logs tenant-service --no-log-prefix --tail 30 2>&1
  echo; echo "### failing node services (last 15 each)"
  for s in api-gateway ingest-service normalizer-service tb-bridge-service incident-service sla-workorder-service correlation-service notification-service audit-service connector-service; do
    echo "--- $s"; docker compose logs "$s" --no-log-prefix --tail 15 2>&1
  done
} > "$OUT" 2>&1
echo "Wrote $OUT ($(wc -l < "$OUT") lines). Tell Claude it is ready."
