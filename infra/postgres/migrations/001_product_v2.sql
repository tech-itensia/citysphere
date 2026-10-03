-- CitySphere v2: device registry, platform governance, lifecycle v2, advisories, shift log, citizen preferences.
-- Idempotent: safe to re-run. Applied by the db-migrate job (infra/postgres/migrate.sh) as the postgres superuser.

CREATE SCHEMA IF NOT EXISTS asset;

-- ---------------------------------------------------------------- tenant-service: plans, modules, quotas, departments, announcements
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS plan          text   NOT NULL DEFAULT 'standard';
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS modules       text[] NOT NULL DEFAULT '{command_centre,digital_twin,sla_workorders,citizen_portal,analytics,integrations}';
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS quotas        jsonb  NOT NULL DEFAULT '{}';
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS contact       jsonb  NOT NULL DEFAULT '{}';
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS population    bigint;
ALTER TABLE tenant.tenants ADD COLUMN IF NOT EXISTS provision_log jsonb  NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS tenant.departments (
  tenant_id   text NOT NULL,
  id          text NOT NULL,
  name        text NOT NULL,
  head        text,
  email       text,
  phone       text,
  categories  text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS tenant.announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,                       -- '*' = every city
  title       text NOT NULL,
  body        text,
  level       text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- asset-service: zone -> site -> asset -> device
CREATE TABLE IF NOT EXISTS asset.sites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  zone        text,
  kind        text NOT NULL DEFAULT 'site',        -- junction, pump-station, substation, street, park, building...
  lat         double precision,
  lon         double precision,
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS asset.assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text NOT NULL,
  site_id        uuid REFERENCES asset.sites(id),
  code           text NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'asset',     -- pole, signal, pump, feeder, bin, bay, vehicle...
  department     text,
  criticality    text NOT NULL DEFAULT 'Medium' CHECK (criticality IN ('Critical','High','Medium','Low')),
  installed_at   date,
  warranty_until date,
  attributes     jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS asset.mapping_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL,
  name        text NOT NULL,
  vendor      text,
  device_type text,
  rules       jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS asset.devices (
  tenant_id    text NOT NULL,
  device_id    text NOT NULL,
  name         text,
  device_type  text NOT NULL,
  status       text NOT NULL DEFAULT 'Registered'
               CHECK (status IN ('Discovered','Registered','Provisioned','Active','Maintenance','Faulty','Decommissioned')),
  serial       text,
  vendor       text,
  model        text,
  firmware     text,
  protocol     text NOT NULL DEFAULT 'http-ingest' CHECK (protocol IN ('mqtt','http','http-ingest','kafka','connector')),
  zone         text,
  site_id      uuid REFERENCES asset.sites(id),
  asset_id     uuid REFERENCES asset.assets(id),
  department   text,
  criticality  text NOT NULL DEFAULT 'Medium' CHECK (criticality IN ('Critical','High','Medium','Low')),
  lat          double precision,
  lon          double precision,
  profile_id   uuid REFERENCES asset.mapping_profiles(id),
  tb_device_id text,
  first_seen   timestamptz,
  last_seen    timestamptz,
  installed_at date,
  notes        text,
  created_by   text NOT NULL DEFAULT 'system',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id)
);
CREATE INDEX IF NOT EXISTS devices_status_idx ON asset.devices (tenant_id, status);
CREATE INDEX IF NOT EXISTS devices_zone_idx   ON asset.devices (tenant_id, zone);

CREATE TABLE IF NOT EXISTS asset.device_events (
  id         bigserial PRIMARY KEY,
  tenant_id  text NOT NULL,
  device_id  text NOT NULL,
  type       text NOT NULL,
  actor      text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_events_idx ON asset.device_events (tenant_id, device_id, at DESC);

-- ---------------------------------------------------------------- incident-service: lifecycle v2, advisories, shift log
ALTER TABLE incident.incidents ADD COLUMN IF NOT EXISTS closure_code     text;
ALTER TABLE incident.incidents ADD COLUMN IF NOT EXISTS site             text;
ALTER TABLE incident.incidents ADD COLUMN IF NOT EXISTS asset            text;
ALTER TABLE incident.incidents ADD COLUMN IF NOT EXISTS photos           jsonb NOT NULL DEFAULT '[]';
ALTER TABLE incident.incidents ADD COLUMN IF NOT EXISTS citizen_feedback jsonb;
UPDATE incident.incidents SET status = 'Resolved'    WHERE status = 'Verified';
UPDATE incident.incidents SET status = 'In Progress' WHERE status = 'Reopened';

CREATE TABLE IF NOT EXISTS incident.advisories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  title        text NOT NULL,
  body         text,
  category     text NOT NULL DEFAULT 'general',
  level        text NOT NULL DEFAULT 'info' CHECK (level IN ('info','warning','critical')),
  zone         text,
  lat          double precision,
  lon          double precision,
  incident_id  uuid,
  starts_at    timestamptz NOT NULL DEFAULT now(),
  ends_at      timestamptz,
  published_by text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advisories_active_idx ON incident.advisories (tenant_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS incident.shift_log (
  id          bigserial PRIMARY KEY,
  tenant_id   text NOT NULL,
  author      text NOT NULL,
  shift       text NOT NULL,
  note        text NOT NULL,
  open_items  jsonb NOT NULL DEFAULT '[]',
  at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- notification-service: per-user preferences (citizens and staff)
CREATE TABLE IF NOT EXISTS notify.preferences (
  tenant_id   text NOT NULL,
  user_id     text NOT NULL,
  email       text,
  phone       text,
  channels    text[] NOT NULL DEFAULT '{email}',
  categories  text[] NOT NULL DEFAULT '{}',
  zones       text[] NOT NULL DEFAULT '{}',
  advisories  boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

-- ---------------------------------------------------------------- row-level security on every new table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = 'announcements' AND policyname = 'tenant_isolation') THEN
    ALTER TABLE tenant.announcements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tenant.announcements FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON tenant.announcements
      USING (public.tenant_visible(tenant_id) OR tenant_id = '*')
      WITH CHECK (public.tenant_visible(tenant_id) OR coalesce(current_setting('app.tenant_id', true), '') = '*');
  END IF;
END $$;

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('tenant','incident','sla','notify','audit','asset') LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = t.schemaname AND tablename = t.tablename AND policyname = 'tenant_isolation') THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', t.schemaname, t.tablename);
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', t.schemaname, t.tablename);
      EXECUTE format('CREATE POLICY tenant_isolation ON %I.%I USING (public.tenant_visible(tenant_id)) WITH CHECK (public.tenant_visible(tenant_id))', t.schemaname, t.tablename);
    END IF;
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA tenant, incident, sla, notify, audit, asset TO scaas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant, incident, sla, notify, asset TO scaas_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA audit TO scaas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tenant, incident, sla, notify, audit, asset TO scaas_app;

-- ---------------------------------------------------------------- demo departments (category routing)
INSERT INTO tenant.departments (tenant_id, id, name, head, email, categories) VALUES
  ('delhi', 'traffic',     'Traffic Police',      'traffic.head',  'traffic@delhi.scaas.local',     '{traffic,parking}'),
  ('delhi', 'water',       'Water Supply',        'waterhead.delhi','water@delhi.scaas.local',      '{water}'),
  ('delhi', 'electricity', 'Electricity',         'power.head',    'power@delhi.scaas.local',       '{electricity}'),
  ('delhi', 'lighting',    'Street Lighting',     'lighting.head', 'lighting@delhi.scaas.local',    '{lighting}'),
  ('delhi', 'waste',       'Solid Waste',         'waste.head',    'waste@delhi.scaas.local',       '{waste}'),
  ('delhi', 'environment', 'Environment',         'env.head',      'environment@delhi.scaas.local', '{environment}'),
  ('delhi', 'transport',   'Transport',           'transport.head','transport@delhi.scaas.local',   '{mobility}'),
  ('delhi', 'disaster',    'Disaster Management', 'dm.head',       'dm@delhi.scaas.local',          '{weather,events,emergency}'),
  ('bengaluru', 'traffic', 'Traffic Police',      NULL, 'traffic@bengaluru.scaas.local', '{traffic,parking}'),
  ('bengaluru', 'water',   'Water Supply',        NULL, 'water@bengaluru.scaas.local',   '{water}'),
  ('bengaluru', 'electricity', 'Electricity',     NULL, 'power@bengaluru.scaas.local',   '{electricity}'),
  ('bengaluru', 'lighting','Street Lighting',     NULL, 'lighting@bengaluru.scaas.local','{lighting}'),
  ('bengaluru', 'waste',   'Solid Waste',         NULL, 'waste@bengaluru.scaas.local',   '{waste}'),
  ('bengaluru', 'environment', 'Environment',     NULL, 'env@bengaluru.scaas.local',     '{environment}')
ON CONFLICT DO NOTHING;

UPDATE tenant.tenants SET population = 2400000, plan = 'enterprise' WHERE id = 'delhi' AND population IS NULL;
UPDATE tenant.tenants SET population = 8400000, plan = 'standard'   WHERE id = 'bengaluru' AND population IS NULL;

INSERT INTO incident.advisories (tenant_id, title, body, category, level, zone, published_by)
SELECT 'delhi', 'Water supply maintenance in Karol Bagh', 'Supply will be reduced 10:00-14:00 while the main is repaired. Tankers are stationed at the market.', 'water', 'warning', 'Karol Bagh', 'seed'
WHERE NOT EXISTS (SELECT 1 FROM incident.advisories WHERE tenant_id = 'delhi');
