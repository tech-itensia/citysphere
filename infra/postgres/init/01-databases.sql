-- Runs once on first start of the postgres container (docker-entrypoint-initdb.d).
-- One Postgres server, three databases: ThingsBoard, Keycloak, and the SCaaS platform.
CREATE DATABASE thingsboard;
CREATE DATABASE keycloak;
CREATE DATABASE scaas;

-- Application role used by every Node.js service. NOT a superuser and NOT the table owner,
-- so Row-Level Security always applies to it.
CREATE ROLE scaas_app LOGIN PASSWORD 'scaas_app';
