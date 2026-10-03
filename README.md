# CitySphere — Smart City as a Service

A multi-tenant smart city platform built on **ThingsBoard CE (microservices mode)**, **Apache Kafka**, **Node.js/TypeScript microservices**, **Keycloak**, **PostgreSQL** and a **React** web app (`apps/web`), all run with Docker. No FIWARE: ThingsBoard is the device layer and a Kafka event envelope is the context model.

**What you get (v2):** nine persona workspaces (Platform Super Admin, City Admin, Leadership, Command Centre Operator, Department Head, Field Technician, Analyst, IT Ops, Citizen), a full Command Centre (queue, live map with layers and 24 h replay, SLA watchlist, correlation insights, advisories, shift handover, wall mode), a device registry with zone → site → asset → device mapping, a 6-step onboarding wizard, CSV import, auto-discovery and vendor-key mapping profiles, the plan's incident lifecycle (Resolution Pending, Escalated, Dismiss), a Super Admin console (city wizard, plans, quotas, modules, suspend/resume, announcements) and a citizen portal (report with photo + pin, confirm or reopen, advisories, journey check, preferences).

```
Devices / integrators ──HTTP──▶ ingest-service ──▶ Kafka scaas.raw.telemetry ──▶ normalizer ──▶ scaas.normalized.observations
Devices (MQTT/HTTP) ──▶ ThingsBoard ──rule chain──▶ Kafka ┘                                          │
Weather / events / traffic / CSV ──▶ connector-service ──▶ scaas.raw.external ─┘                    ▼
                                                                         tb-bridge ──▶ ThingsBoard twin + alarm rules
                                                                                            │ rule chain
                                                                                            ▼
                              correlation-service ──▶ scaas.alerts ◀────────────────────────┘
                                                          │
                                         incident-service ▼ ──▶ scaas.incidents ──▶ sla-workorder-service ──▶ scaas.sla
                                                                     │                         │
                                                notification-service ◀─────────────────────────┘ (email / SMS / webhook / push)
React app ──▶ api-gateway (Keycloak OIDC, tenant + persona RBAC, SSE live feed) ──▶ all services
```

## Services

| Service | Port | What it does |
| --- | --- | --- |
| `api-gateway` | 8088 | Single API for the web apps: OIDC token check, tenant + persona RBAC, rate limits, audit, `/api/overview`, live `/api/stream` (SSE) |
| `ingest-service` | 8091 | **Device data front door.** Validates telemetry (single or 1000-record batches) and publishes it to Kafka |
| `normalizer-service` | – | Raw → normalized observations: key aliases, units, type inference, timestamp checks; bad data → DLQ |
| `tb-bridge-service` | – | Kafka → ThingsBoard (auto-registers devices, so alarm rules run); fast Redis twin cache; twin API (state, history, health) |
| `incident-service` | – | Alarms + correlations + operator/citizen reports → incidents; lifecycle, de-duplication, stats, trend |
| `sla-workorder-service` | – | Response/resolution SLA timers (green/amber/red), breach escalation, built-in work orders |
| `correlation-service` | – | Cross-domain rules: rain + congestion, public event + congestion, several low-pressure nodes = main break |
| `notification-service` | – | Rule-based email (Mailpit in dev), SMS, webhook and push notifications |
| `audit-service` | – | Append-only audit trail of every change |
| `tenant-service` | – | Cities, plans/quotas/modules, suspend/resume, ThingsBoard provisioning with a step log, departments + category routing, users & roles (Keycloak admin API), announcements, API keys |
| `asset-service` | – | Device registry: zone → site → asset → device, 7-state device lifecycle, ThingsBoard provisioning (token + attributes), CSV import with dry run, auto-discovery of unknown senders, mapping profiles; publishes a Redis projection used by normalizer and incident-service |
| `web` | 5173 | React app: all persona dashboards and the Command Centre (falls back to built-in demo data when the gateway is down) |
| `db-migrate` | – | One-shot job: applies `infra/postgres/migrations/*.sql` in order before the services start |
| `connector-service` | – | Weather (Open-Meteo), public events, generic traffic feed, CSV batch import |
| `tools/simulator` | – | 227 simulated devices across two cities plus 12 incident scenarios |

ThingsBoard runs as separate containers: `tb-core1`, `tb-rule-engine1`, `tb-mqtt-transport1`, `tb-http-transport1`, `tb-web-ui1` and `tb-js-executor`. They use the same Kafka as their queue, with ZooKeeper for discovery and an nginx `tb-proxy` in front.

## Quick start

Requirements: Docker Desktop with **at least 10 GB of memory** assigned (Settings → Resources), and ~15 GB of disk.

```bash
cp .env.example .env
./scripts/install-tb.sh                       # one time: ThingsBoard schema
docker compose up -d --build                  # whole platform (first build ~5 min)
docker compose logs -f tenant-service         # wait for "tenant provisioned" x2 (delhi, bengaluru)
docker compose --profile sim up -d simulator  # start sending city data
./scripts/smoke-test.sh                       # end-to-end check
```

| URL | What | Login |
| --- | --- | --- |
| http://localhost:5173 | **CitySphere web app** | pick a demo persona, or SSO with `operator.delhi` / `Demo@123` |
| http://localhost:8088 | SCaaS API gateway | Keycloak token, or a dev token (below) |
| http://localhost:8091/v1/schema | Ingest API | `x-api-key` |
| http://localhost:8080 | ThingsBoard UI | `sysadmin@thingsboard.org` / `sysadmin` |
| http://localhost:8180 | Keycloak admin | `admin` / `admin` |
| http://localhost:8085 | Kafka UI | – |
| http://localhost:8025 | Mailpit (all outgoing email) | – |

### Demo users (Keycloak realm `scaas`, password `Demo@123`)

| User | Persona | Tenant |
| --- | --- | --- |
| `superadmin` | Platform Super Admin | all |
| `admin.delhi`, `admin.bengaluru` | City Admin | own city |
| `mayor.delhi` | Leadership | delhi |
| `operator.delhi` | Command Centre Operator | delhi |
| `waterhead.delhi` | Department Head (water) | delhi |
| `tech.delhi` | Field Technician | delhi |
| `analyst.delhi` | Analyst | delhi |
| `itops.delhi` | IT / Platform Ops | delhi |
| `citizen.delhi` | Citizen | delhi |

The same set exists for Bengaluru. Get a token for API testing:

```bash
curl -s -X POST http://localhost:8180/realms/scaas/protocol/openid-connect/token \
  -d grant_type=password -d client_id=scaas-web -d username=operator.delhi -d password='Demo@123' | jq -r .access_token
```

For quick curl tests, `ALLOW_DEV_TOKENS=true` (dev only) also accepts `Authorization: Bearer dev:<user>:<tenant>:<role,role>`.

## Upgrading an existing install to v2

```bash
git pull
docker compose up -d --build        # db-migrate applies 001_product_v2.sql, asset-service seeds the demo registry
./scripts/fix-keycloak.sh           # only if logins show "no SCaaS persona role"
```

The migration is idempotent and keeps existing data (old `Verified` incidents become `Resolved`, `Reopened` become `In Progress`).

## Sending device data

**Over HTTP (any device, gateway or integrator):**

```bash
curl -X POST http://localhost:8091/v1/telemetry \
  -H 'x-api-key: sk_delhi_demo_0000000000000000000001' -H 'content-type: application/json' \
  -d '{"records":[{"deviceId":"WN-KAROLB-09","deviceType":"Water Node","zone":"Karol Bagh",
       "location":{"lat":28.651,"lon":77.19},"values":{"pressureBar":1.1,"flowLpm":900}}]}'
```

Create more keys with `POST /api/tenants/{id}/api-keys` (City Admin or IT Ops). Trusted internal systems can also produce straight to Kafka, and devices can still talk MQTT to ThingsBoard. See [docs/kafka-contract.md](docs/kafka-contract.md) and [docs/ingest-api.yaml](docs/ingest-api.yaml).

**Simulator scenarios** (each trips real ThingsBoard alarm rules):

```bash
docker compose run --rm simulator node_modules/.bin/tsx tools/simulator/src/index.ts --list-scenarios
docker compose run --rm simulator node_modules/.bin/tsx tools/simulator/src/index.ts --once --scenario=storm
```

## Multi-tenancy

One tenant = one city. Each tenant gets its own ThingsBoard tenant (provisioned automatically, with device profiles, alarm rules, City → Zone asset tree and Kafka export rule chain). It also gets a Keycloak group `/tenants/<id>` (with department sub-groups), Postgres rows isolated by **Row-Level Security**, Kafka events keyed by tenant, and Redis keys prefixed `t:<id>:`. Onboard a new city:

```bash
curl -X POST http://localhost:8088/api/tenants -H 'Authorization: Bearer dev:root:platform:super_admin' \
  -H 'content-type: application/json' \
  -d '{"id":"pune","name":"Pune Municipal Corporation","cityName":"Pune","center":{"lat":18.52,"lon":73.856},
       "zones":[{"name":"Shivajinagar","lat":18.531,"lon":73.847}]}'
```

## Development

```bash
npm install
npm test             # unit tests (node:test) for the pure logic in every service
npm run typecheck
docker compose up -d postgres redis kafka kafka-init keycloak     # infra only
KAFKA_BROKERS=localhost:29092 DATABASE_URL=postgres://scaas_app:scaas_app@localhost:5432/scaas \
  npx tsx watch services/incident-service/src/index.ts
```

Each service is an independent npm workspace in `services/*`, sharing `packages/common` (Kafka with retries/DLQ/idempotency, Postgres with tenant scoping, Fastify app, audit, metrics) and `packages/thingsboard` (REST client, device catalogue with alarm rules, provisioning). Every service exposes `/health`, `/ready` and Prometheus `/metrics`.

## Notes and limits

- ThingsBoard **Community Edition** has no custom roles or integrations, so personas, RBAC, SSO and integrations live in the Node.js layer. ThingsBoard stays behind the gateway.
- `TB_VERSION=latest` is convenient for development; pin a version (e.g. `4.2.1`) for staging and production.
- Production hardening still to do: Kafka SASL/TLS + ACLs, secrets in Vault/KMS, Helm charts for Kubernetes, OpenTelemetry tracing.
