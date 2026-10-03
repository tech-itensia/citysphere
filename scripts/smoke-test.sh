#!/usr/bin/env bash
# End-to-end check once the stack is up: device data in -> Kafka -> ThingsBoard alarm -> incident -> SLA.
# Uses a dev token (ALLOW_DEV_TOKENS=true) so no Keycloak login is needed.
set -euo pipefail
GW=${GW:-http://localhost:8088}
INGEST=${INGEST:-http://localhost:8091}
KEY=${KEY:-sk_delhi_demo_0000000000000000000001}
AUTH="Authorization: Bearer dev:operator.delhi:delhi:operator,city_admin"

echo "1) Tenant status"
curl -sf "$GW/api/tenants/delhi" -H "$AUTH" | sed 's/,"zones".*//' ; echo

echo "2) Post a bin reading above the 85% alarm threshold through ingest-service (-> Kafka)"
curl -sf -X POST "$INGEST/v1/devices/WB-SMOKE-01/telemetry" -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"deviceType":"Smart Bin","zone":"Connaught Place","fillPct":95,"temperatureC":31,"location":{"lat":28.6315,"lon":77.2167}}'; echo

echo "3) Waiting 20 s for normalizer -> tb-bridge -> ThingsBoard alarm -> incident..."
sleep 20
curl -sf "$GW/api/twin/devices/WB-SMOKE-01" -H "$AUTH" | head -c 400; echo
curl -sf "$GW/api/incidents?open=true&limit=5" -H "$AUTH" | head -c 800; echo

echo "4) Overview (leadership dashboard payload)"
curl -sf "$GW/api/overview" -H "$AUTH" | head -c 600; echo
