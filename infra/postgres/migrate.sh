#!/bin/sh
# Applies infra/postgres/migrations/*.sql to the scaas database in name order, once each.
# Runs as a one-shot compose job (db-migrate) before the Node services start.
set -eu
export PGHOST="${PGHOST:-postgres}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" PGDATABASE=scaas
DIR="${MIGRATIONS_DIR:-/migrations}"

# Wait until the init scripts have created the scaas schema (first start runs them on a socket-only server).
i=0
until psql -tAc "select 1 from information_schema.schemata where schema_name='tenant'" 2>/dev/null | grep -q 1; do
  i=$((i + 1)); [ "$i" -gt 90 ] && { echo "scaas database not ready"; exit 1; }
  echo "waiting for scaas database..."; sleep 2
done

psql -v ON_ERROR_STOP=1 -qc "create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())"
for f in $(ls "$DIR"/*.sql | sort); do
  name=$(basename "$f")
  if [ -n "$(psql -tAc "select 1 from public.schema_migrations where name='$name'")" ]; then
    echo "skip  $name"; continue
  fi
  echo "apply $name"
  psql -v ON_ERROR_STOP=1 -q -1 -f "$f"
  psql -qc "insert into public.schema_migrations (name) values ('$name')"
done
echo "migrations complete"
