#!/usr/bin/env bash
# Shows ThingsBoard users and resets the system administrator password to "sysadmin" (BCrypt via pgcrypto).
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="docker compose exec -T postgres psql -U postgres -d thingsboard -v ON_ERROR_STOP=1"
echo "== ThingsBoard users =="
$PSQL -c "select u.email, u.authority, c.enabled from tb_user u left join user_credentials c on c.user_id = u.id order by u.authority, u.email;"
echo "== Resetting sysadmin@thingsboard.org password to 'sysadmin' =="
$PSQL -c "create extension if not exists pgcrypto;" \
      -c "update user_credentials set password = crypt('sysadmin', gen_salt('bf', 10)), enabled = true, activate_token = null
          where user_id = (select id from tb_user where email = 'sysadmin@thingsboard.org');"
echo "Done. Clearing cached credentials (Redis) and restarting tb-core1..."
docker compose exec -T redis redis-cli FLUSHALL
docker compose restart tb-core1
