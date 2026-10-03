/**
 * Demo registry for the seeded cities: the simulator fleet becomes a mapped hierarchy
 * (zone -> site -> asset -> device) so every screen has realistic data on first start.
 * Two vendor devices are deliberately left out so they show up in the Discovered queue.
 */
import { withTenant, logger } from "@scaas/common";
import { deviceTypeByName } from "@scaas/thingsboard";
import { CITIES } from "../../../tools/simulator/src/cities.ts";
import { buildFleet, TYPE_NAMES, type Kind } from "../../../tools/simulator/src/fleet.ts";
import { slug } from "./registry.ts";

const DEPARTMENT: Record<string, string> = {
  lighting: "Street Lighting", traffic: "Traffic Police", parking: "Traffic Police", environment: "Environment", water: "Water Supply",
  electricity: "Electricity", waste: "Solid Waste", mobility: "Transport", emergency: "Disaster Management", weather: "Disaster Management",
};
const SITE: Record<Kind, [string, string]> = {
  SL: ["Street Grid", "street"], TJ: ["Junction", "junction"], AQ: ["AQ Station", "station"], WN: ["Water Network", "pipeline"],
  PM: ["Substation", "substation"], WB: ["Ward Bins", "ward"], PK: ["Parking Zone", "parking"], VH: ["City Fleet Depot", "depot"],
  DR: ["Drone Port", "depot"], AT: ["Vertiport", "depot"], ER: ["Emergency Base", "depot"], RG: ["City Weather Station", "station"],
};
const ASSET: Record<Kind, [string, string]> = {
  SL: ["Pole", "pole"], TJ: ["Signal head", "signal"], AQ: ["AQ mast", "mast"], WN: ["Main", "pipe"], PM: ["Feeder", "feeder"], WB: ["Bin", "bin"],
  PK: ["Bay", "bay"], VH: ["Vehicle", "vehicle"], DR: ["Drone", "drone"], AT: ["Air taxi", "aircraft"], ER: ["Unit", "vehicle"], RG: ["Weather mast", "mast"],
};
const CRIT: Partial<Record<Kind, string>> = { TJ: "High", WN: "High", PM: "Critical", ER: "Critical", AQ: "Medium" };
const VENDOR: Record<Kind, string> = { SL: "Signify", TJ: "Siemens Mobility", AQ: "Aeroqual", WN: "Siemens", PM: "Schneider", WB: "Sensoneo", PK: "Nedap", VH: "Tata", DR: "ideaForge", AT: "ePlane", ER: "Force", RG: "Davis" };

export async function seedDemoRegistry(tenantId: string, _zones?: unknown) {
  const city = CITIES[tenantId];
  if (!city) return;
  await withTenant(tenantId, async (db) => {
    const n = (await db.query("select count(*)::int n from asset.devices where status <> 'Discovered'")).rows[0].n;
    if (n > 0) return;
    const fleet = buildFleet(city, 1);
    const siteIds = new Map<string, string>();
    let i = 0;
    for (const d of fleet) {
      i++;
      const type = TYPE_NAMES[d.kind];
      const domain = deviceTypeByName(type)?.domain ?? "generic";
      const cityWide = ["VH", "DR", "AT", "ER", "RG"].includes(d.kind);
      const [siteWord, siteKind] = SITE[d.kind];
      const siteName = cityWide ? siteWord : d.kind === "TJ" ? `${d.zone} ${siteWord} ${d.id.slice(-2)}` : `${d.zone} ${siteWord}`;
      let siteId = siteIds.get(siteName);
      if (!siteId) {
        siteId = (await db.query(
          `insert into asset.sites (tenant_id, code, name, zone, kind, lat, lon) values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (tenant_id, code) do update set name = excluded.name returning id`,
          [tenantId, slug(siteName), siteName, cityWide ? null : d.zone, siteKind, d.lat, d.lon])).rows[0].id as string;
        siteIds.set(siteName, siteId);
      }
      const [assetWord, assetKind] = ASSET[d.kind];
      const assetName = `${assetWord} ${d.id}`;
      const assetId = (await db.query(
        `insert into asset.assets (tenant_id, site_id, code, name, kind, department, criticality, installed_at) values ($1,$2,$3,$4,$5,$6,$7, now()::date - ($8::int))
         on conflict (tenant_id, code) do update set site_id = excluded.site_id returning id`,
        [tenantId, siteId, slug(assetName), assetName, assetKind, DEPARTMENT[domain] ?? "Operations", CRIT[d.kind] ?? "Medium", 30 + (i % 600)])).rows[0].id;
      await db.query(
        `insert into asset.devices (tenant_id, device_id, name, device_type, status, serial, vendor, model, firmware, protocol, zone, site_id, asset_id,
           department, criticality, lat, lon, installed_at, created_by)
         values ($1,$2,$3,$4,'Active',$5,$6,$7,$8,'http-ingest',$9,$10,$11,$12,$13,$14,$15, now()::date - ($16::int), 'seed')
         on conflict (tenant_id, device_id) do update set status='Active', name=excluded.name, device_type=excluded.device_type, serial=excluded.serial,
           vendor=excluded.vendor, model=excluded.model, firmware=excluded.firmware, zone=excluded.zone, site_id=excluded.site_id, asset_id=excluded.asset_id,
           department=excluded.department, criticality=excluded.criticality, lat=excluded.lat, lon=excluded.lon, created_by='seed', updated_at=now()
         where asset.devices.status = 'Discovered'`,
        [tenantId, d.id, `${type} ${d.id}`, type, `SN-${tenantId.slice(0, 3).toUpperCase()}-${String(10000 + i)}`, VENDOR[d.kind], `${d.kind}-${2024 + (i % 3)}`,
          `${1 + (i % 3)}.${i % 10}.${i % 7}`, cityWide ? city.zones[0].name : d.zone, siteId, assetId, DEPARTMENT[domain] ?? "Operations", CRIT[d.kind] ?? "Medium", d.lat, d.lon, 30 + (i % 600)]);
    }
    await db.query(
      `insert into asset.mapping_profiles (tenant_id, name, vendor, device_type, rules)
       select $1, 'Acme AirSense v2', 'Acme', 'Air Quality Station', $2::jsonb
       where not exists (select 1 from asset.mapping_profiles where tenant_id = $1)`,
      [tenantId, JSON.stringify([
        { from: "pm2_5_ugm3", to: "pm25" }, { from: "pm10_ugm3", to: "pm10" }, { from: "no2_ppb", to: "no2", scale: 1.88 },
        { from: "temp_f", to: "temperatureC", scale: 0.5556, offset: -17.778 }, { from: "rssi", to: "", drop: true },
      ])]);
    logger.info({ tenantId, devices: fleet.length, sites: siteIds.size }, "demo device registry seeded");
  });
}
