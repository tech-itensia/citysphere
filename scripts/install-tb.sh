#!/usr/bin/env bash
# One-time ThingsBoard database install (creates schema + system admin). Safe to re-run: it upgrades nothing
# and exits if the schema already exists.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
echo "Starting Postgres, Redis, ZooKeeper and Kafka..."
docker compose up -d postgres redis zookeeper kafka kafka-init
docker compose run --rm --no-deps -e INSTALL_TB=true -e LOAD_DEMO=false tb-core1
echo "ThingsBoard schema installed. Next: docker compose up -d --build"
