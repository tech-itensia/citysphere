\connect scaas

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Each microservice owns one schema. Every table carries tenant_id and is protected by RLS:
-- services run `set_config('app.tenant_id', <tenant>, true)` per transaction ('*' = platform scope).
CREATE SCHEMA tenant;
CREATE SCHEMA incident;
CREATE SCHEMA sla;
CREATE SCHEMA notify;
CREATE SCHEMA audit;

CREATE OR REPLACE FUNCTION public.tenant_visible(t text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.tenant_id', true), '') IN (t, '*')
$$;

-- ---------------------------------------------------------------- tenant-service
CREATE TABLE tenant.tenants (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  city_name             text NOT NULL,
  center                jsonb NOT NULL,
  zones                 jsonb NOT NULL DEFAULT '[]',
  branding              jsonb NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','provisioning','active','failed','suspended')),
  error                 text,
  tb_tenant_id          text,
  tb_admin_email        text,
  tb_admin_password_enc text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tenant.api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES tenant.tenants(id),
  name        text NOT NULL,
  prefix      text NOT NULL,
  key_hash    text NOT NULL UNIQUE,
  scopes      text[] NOT NULL DEFAULT '{telemetry:write}',
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- ---------------------------------------------------------------- incident-service
CREATE TABLE incident.incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           bigserial,
  tenant_id        text NOT NULL,
  title            text NOT NULL,
  description      text,
  category         text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('Critical','High','Medium','Low')),
  status           text NOT NULL DEFAULT 'New',
  source           text NOT NULL,
  device_id        text,
  device_type      text,
  alarm_id         text,
  alarm_type       text,
  zone             text,
  lat              double precision,
  lon              double precision,
  department       text,
  assignee         text,
  reporter         text,
  escalation_level int NOT NULL DEFAULT 0,
  source_cleared   boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  resolved_at      timestamptz,
  closed_at        timestamptz
);
CREATE INDEX ON incident.incidents (tenant_id, status, severity);
CREATE INDEX ON incident.incidents (tenant_id, created_at DESC);
CREATE INDEX ON incident.incidents (alarm_id);
CREATE INDEX ON incident.incidents (tenant_id, device_id, category);

CREATE TABLE incident.incident_events (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL,
  incident_id uuid NOT NULL REFERENCES incident.incidents(id),
  type        text NOT NULL,
  actor       text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON incident.incident_events (incident_id, at);

-- ---------------------------------------------------------------- sla-workorder-service
CREATE TABLE sla.policies (
  tenant_id      text NOT NULL,
  category       text NOT NULL,           -- '*' = any category
  severity       text NOT NULL,
  response_min   int NOT NULL,
  resolution_min int NOT NULL,
  amber_pct      int NOT NULL DEFAULT 75,
  escalate_to    text NOT NULL DEFAULT '',
  auto_escalate  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, category, severity)
);
CREATE TABLE sla.timers (
  incident_id         uuid PRIMARY KEY,
  tenant_id           text NOT NULL,
  category            text NOT NULL,
  severity            text NOT NULL,
  created_at          timestamptz NOT NULL,
  response_due        timestamptz NOT NULL,
  resolution_due      timestamptz NOT NULL,
  response_met_at     timestamptz,
  resolution_met_at   timestamptz,
  response_status     text NOT NULL DEFAULT 'green',
  resolution_status   text NOT NULL DEFAULT 'green',
  response_breached   boolean NOT NULL DEFAULT false,
  resolution_breached boolean NOT NULL DEFAULT false,
  escalate_to         text NOT NULL DEFAULT '',
  auto_escalate       boolean NOT NULL DEFAULT false
);
CREATE INDEX ON sla.timers (tenant_id, resolution_met_at);

CREATE TABLE sla.work_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number       bigserial,
  tenant_id    text NOT NULL,
  incident_id  uuid,
  title        text NOT NULL,
  description  text,
  status       text NOT NULL,
  priority     text NOT NULL,
  department   text,
  assignee     text,
  due_at       timestamptz,
  checklist    jsonb NOT NULL DEFAULT '[]',
  evidence     jsonb NOT NULL DEFAULT '[]',
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ON sla.work_orders (tenant_id, status);
CREATE INDEX ON sla.work_orders (tenant_id, assignee);
CREATE TABLE sla.work_order_events (
  id            bigserial PRIMARY KEY,
  tenant_id     text NOT NULL,
  work_order_id uuid NOT NULL REFERENCES sla.work_orders(id),
  type          text NOT NULL,
  actor         text NOT NULL,
  data          jsonb NOT NULL DEFAULT '{}',
  at            timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- notification-service
CREATE TABLE notify.channels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('email','sms','webhook','push')),
  target       text NOT NULL,             -- address, phone, URL, or '$assignee'
  secret       text,
  events       text[] NOT NULL,           -- incident.created, incident.escalated, sla.amber, sla.breached, workorder.assigned, manual, *
  min_severity text NOT NULL DEFAULT 'High',
  department   text,
  enabled      boolean NOT NULL DEFAULT true
);
CREATE TABLE notify.notifications (
  id        bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  channel   text NOT NULL,
  recipient text NOT NULL,
  kind      text NOT NULL,
  subject   text NOT NULL,
  body      text,
  status    text NOT NULL,
  error     text,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notify.notifications (tenant_id, at DESC);

-- ---------------------------------------------------------------- audit-service (append-only)
CREATE TABLE audit.audit_log (
  id        bigserial PRIMARY KEY,
  event_id  text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  actor     text NOT NULL,
  action    text NOT NULL,
  resource  text NOT NULL,
  source    text NOT NULL,
  ip        text,
  data      jsonb NOT NULL DEFAULT '{}',
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit.audit_log (tenant_id, at DESC);

-- ---------------------------------------------------------------- RLS + grants
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('tenant','incident','sla','notify','audit') LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', t.schemaname, t.tablename);
    IF t.schemaname = 'tenant' AND t.tablename = 'tenants' THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I USING (public.tenant_visible(id)) WITH CHECK (public.tenant_visible(id))', t.schemaname, t.tablename);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I USING (public.tenant_visible(tenant_id)) WITH CHECK (public.tenant_visible(tenant_id))', t.schemaname, t.tablename);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA tenant, incident, sla, notify, audit TO scaas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant, incident, sla, notify TO scaas_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO scaas_app;          -- no UPDATE/DELETE: append-only
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tenant, incident, sla, notify, audit TO scaas_app;

-- ---------------------------------------------------------------- demo notification channels (MailHog)
INSERT INTO notify.channels (tenant_id, channel, target, events, min_severity) VALUES
  ('delhi', 'email', 'control-room@delhi.scaas.local', '{incident.created,incident.escalated,sla.breached}', 'High'),
  ('delhi', 'email', '$assignee', '{workorder.assigned}', 'Low'),
  ('delhi', 'sms', '+910000000000', '{sla.breached}', 'Critical'),
  ('bengaluru', 'email', 'control-room@bengaluru.scaas.local', '{incident.created,incident.escalated,sla.breached}', 'High');
