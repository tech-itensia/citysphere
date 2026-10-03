#!/usr/bin/env bash
# Rebuilds the ThingsBoard database (it was installed without any users), makes config files readable
# by the containers, and lets tenant-service provision the demo cities again.
# Safe for a fresh dev setup: it deletes ThingsBoard data only (SCaaS incidents/work orders are kept).
set -uo pipefail
cd "$(dirname "$0")/.."
PG="docker compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1"

echo "1/7 Making project files readable inside containers..."
chmod -R a+rX infra scripts docs services packages tools 2>/dev/null; chmod +x scripts/*.sh

echo "2/7 Stopping ThingsBoard and the services that call it..."
docker compose stop tb-proxy tb-web-ui1 tb-http-transport1 tb-mqtt-transport1 tb-core1 tb-rule-engine1 tb-js-executor tenant-service tb-bridge-service simulator >/dev/null 2>&1

echo "3/7 Recreating an empty ThingsBoard database..."
$PG -d postgres -c "DROP DATABASE IF EXISTS thingsboard WITH (FORCE);" -c "CREATE DATABASE thingsboard;" || exit 1

echo "4/7 Installing ThingsBoard schema + system data + demo data (takes 1-3 min)..."
docker compose run --rm --no-deps -e INSTALL_TB=true -e LOAD_DEMO=true tb-core1 2>&1 | grep -vE "^WARNING|^\s*$" | tail -15

echo "5/7 Checking the system administrator account..."
USERS=$($PG -d thingsboard -tAc "select count(*) from tb_user where authority='SYS_ADMIN';")
echo "    SYS_ADMIN users: ${USERS:-?}"
if [ "${USERS:-0}" = "0" ]; then
  echo "    None found - creating sysadmin@thingsboard.org / sysadmin directly in the database"
  $PG -d thingsboard <<'SQL'
create extension if not exists pgcrypto;
insert into tb_user (id, created_time, tenant_id, customer_id, email, authority, first_name, last_name, additional_info)
values (gen_random_uuid(), (extract(epoch from now())*1000)::bigint, '13814000-1dd2-11b2-8080-808080808080',
        '13814000-1dd2-11b2-8080-808080808080', 'sysadmin@thingsboard.org', 'SYS_ADMIN', 'System', 'Administrator', '{}');
insert into user_credentials (id, created_time, user_id, enabled, password)
select gen_random_uuid(), (extract(epoch from now())*1000)::bigint, id, true, crypt('sysadmin', gen_salt('bf', 10))
from tb_user where email = 'sysadmin@thingsboard.org';
SQL
fi
$PG -d thingsboard -c "select email, authority from tb_user order by authority, email;"

echo "6/7 Resetting SCaaS tenant provisioning + caches..."
$PG -d scaas -c "update tenant.tenants set status='pending', error=null, tb_tenant_id=null, tb_admin_email=null, tb_admin_password_enc=null;"
docker compose exec -T redis redis-cli FLUSHALL >/dev/null

echo "7/7 Starting everything..."
docker compose up -d --force-recreate tb-js-executor tb-core1 tb-rule-engine1 tb-http-transport1 tb-mqtt-transport1 tb-web-ui1 tb-proxy >/dev/null 2>&1
echo "    waiting for ThingsBoard login to work..."
for i in $(seq 1 60); do
  R=$(curl -s -X POST http://localhost:8080/api/auth/login -H 'content-type: application/json' \
       -d '{"username":"sysadmin@thingsboard.org","password":"sysadmin"}' | head -c 9)
  if [ "$R" = '{"token":' ]; then echo "    ThingsBoard login OK"; break; fi
  sleep 5
done
docker compose up -d tenant-service tb-bridge-service >/dev/null 2>&1
docker compose restart tenant-service tb-bridge-service >/dev/null 2>&1
echo "Done. In ~1 minute run: ./scripts/diagnose.sh   (then tell Claude 'ready')"
