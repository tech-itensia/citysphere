#!/usr/bin/env bash
# Re-imports the "scaas" realm so access tokens carry realm roles (realm_access.roles), sub and groups.
set -euo pipefail
cd "$(dirname "$0")/.."
chmod -R a+rX infra/keycloak
KC_USER=${KEYCLOAK_ADMIN:-admin}; KC_PASS=${KEYCLOAK_ADMIN_PASSWORD:-admin}
echo "==> Deleting old realm 'scaas' (if present)"
docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080 --realm master --user "$KC_USER" --password "$KC_PASS"
docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh delete realms/scaas || true
echo "==> Restarting Keycloak (re-imports infra/keycloak/realm-scaas.json)"
docker compose restart keycloak
for i in $(seq 1 60); do
  if curl -sf http://localhost:8180/realms/scaas/.well-known/openid-configuration >/dev/null; then break; fi; sleep 3
done
echo "==> Checking token for operator.delhi"
TOKEN=$(curl -s -X POST http://localhost:8180/realms/scaas/protocol/openid-connect/token \
  -d grant_type=password -d client_id=scaas-web -d username=operator.delhi -d 'password=Demo@123' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
TOKEN="$TOKEN" python3 -c '
import os,json,base64
seg=os.environ["TOKEN"].split(".")[1]; seg+="="*(-len(seg)%4)
p=json.loads(base64.urlsafe_b64decode(seg))
print("sub:", p.get("sub")); print("roles:", p.get("realm_access",{}).get("roles")); print("groups:", p.get("groups"))'

echo "==> /api/me via gateway"
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:${GATEWAY_PORT:-8088}/api/me; echo
echo "Done. Log out of the web app (or open a private window) and sign in again."
