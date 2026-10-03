import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Donut, Sparkline } from "../components/Charts";
import { Icon } from "../components/Icon";
import { IncidentDrawer } from "../components/IncidentDrawer";
import { useApi } from "../lib/useApi";
import { useLive } from "../lib/live";
import { DOMAINS, SEV_COLOR, STATUS_COLOR, compact, domainOf, fmt, statusTone, statusWord, timeAgo } from "../lib/format";

const TILE_DOMAINS = ["electricity", "traffic", "water", "emergency", "mobility", "environment"];
const POPULATION: Record<string, number> = { delhi: 2_400_000, bengaluru: 8_400_000 };

/** Leadership / Mayor: the "Smart City Operating System" screen from the supplied design. */
export function Overview() {
  const { data, reload } = useApi<any>("/overview", 20_000);
  const { data: devices } = useApi<any[]>("/twin/devices", 20_000);
  const [open, setOpen] = useState<string>();
  const history = useRef<Record<string, number[]>>({});
  const [, force] = useState(0);

  useLive((e) => { if (e.event === "incident" || e.event === "alert") void reload(); });

  // keep a short health history per domain for the sparklines
  useEffect(() => {
    for (const d of data?.twin?.domains ?? []) {
      const h = history.current[d.domain] ?? Array.from({ length: 10 }, (_, i) => d.healthPct + Math.sin(i * 1.3 + d.total) * 2);
      history.current[d.domain] = [...h, d.healthPct].slice(-14);
    }
    force((n) => n + 1);
  }, [data]);

  const domains: any[] = data?.twin?.domains ?? [];
  const tiles = TILE_DOMAINS.map((k) => domains.find((d) => d.domain === k) ?? { domain: k, healthPct: 100, total: 0 });
  const center = data?.tenant?.center ?? { lat: 28.6139, lon: 77.209 };
  const aqi = useMemo(() => {
    const vals = (devices ?? []).map((d) => d.values?.aqi).filter((v) => typeof v === "number");
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined;
  }, [devices]);
  const online = (devices ?? []).filter((d) => d.online !== false).length;
  const uptime = devices?.length ? (online / devices.length) * 100 : undefined;

  return (
    <Page title={<>Smart City<br />Operating System</>} subtitle="Real-time overview and management of city infrastructure and services.">
      <div className="grid cols-6">
        {tiles.map((t) => {
          const meta = domainOf(t.domain);
          const label = t.domain === "emergency" ? (t.healthPct >= 95 ? "Ready" : "Stretched") : t.domain === "mobility" ? "Active" : statusWord(t.healthPct);
          const tone = t.domain === "mobility" ? "#2563eb" : statusTone(t.healthPct);
          return (
            <div key={t.domain} className="card tile">
              <div className="head"><Icon name={meta.icon} size={24} color={meta.color} /> {meta.label}</div>
              <div className="val">{t.total ? `${Math.round(t.healthPct)}%` : "–"}</div>
              <div className="foot">
                <span className="state" style={{ color: tone }}>{t.total ? label : "No devices"}</span>
                <Sparkline values={history.current[t.domain] ?? [1, 1]} color={meta.color} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid main-side mt">
        <div className="card">
          <CityMap title="City Live Map" center={center} devices={devices ?? []} incidents={data?.recentAlerts ?? []} onSelectIncident={setOpen} showLegend={false} />
          <div className="kpis mt">
            <div className="kpi"><Icon name="Users" size={22} color="#64748b" /><div><b>{compact(POPULATION[data?.tenant?.id ?? "delhi"] ?? 1_000_000)}</b><span>Population</span></div></div>
            <div className="kpi"><Icon name="Building2" size={22} color="#64748b" /><div><b>{fmt(data?.twin?.devices)}</b><span>City Assets</span></div></div>
            <div className="kpi"><Icon name="Activity" size={22} color="#64748b" /><div><b>{uptime !== undefined ? `${uptime.toFixed(1)}%` : "–"}</b><span>Assets Online</span></div></div>
            <div className="kpi"><Icon name="Leaf" size={22} color="#22c55e" /><div><b>{aqi ?? "–"}{aqi !== undefined && <span className="delta">{aqi <= 100 ? "Good" : aqi <= 200 ? "Moderate" : "Poor"}</span>}</b><span>Air Quality (AQI)</span></div></div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>System Overview <Link className="sub" to="/twin"><Icon name="ChevronRight" size={18} /></Link></h3>
            <div className="row" style={{ gap: 26, alignItems: "center" }}>
              <Donut value={data?.twin?.overallScore ?? 0} />
              <div style={{ flex: 1, display: "grid", gap: 14, fontSize: 13 }}>
                {Object.entries(STATUS_COLOR).map(([k, c]) => (
                  <div key={k} className="row between"><span className="row"><i style={{ width: 9, height: 9, borderRadius: 9, background: c, display: "inline-block" }} />{k}</span><b>{data?.twin?.statusCounts?.[k] ?? 0}</b></div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <h3>Recent Alerts <Link className="sub" to="/incidents">View All</Link></h3>
            {(data?.recentAlerts ?? []).slice(0, 4).map((i: any) => {
              const m = DOMAINS[i.category] ?? DOMAINS.generic;
              return (
                <div key={i.id} className="alert-item" onClick={() => setOpen(i.id)}>
                  <span className="ic" style={{ background: `${m.color}1a` }}><Icon name={m.icon} size={18} color={m.color} /></span>
                  <div className="t"><b>{i.title}</b><span>{i.zone ?? i.department ?? ""}</span></div>
                  <span className="when">{timeAgo(i.createdAt)}</span>
                  <span className="sevdot" style={{ background: SEV_COLOR[i.severity] }} />
                </div>
              );
            })}
            {!data?.recentAlerts?.length && <div className="empty">No open alerts</div>}
          </div>
          <div className="card">
            <h3>Service levels <span className="hint" style={{ marginLeft: "auto" }}>30 days</span></h3>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <div><b style={{ fontSize: 22 }}>{fmt(data?.sla?.responseCompliancePct, 1)}%</b><div className="hint">Response SLA met</div></div>
              <div><b style={{ fontSize: 22 }}>{fmt(data?.sla?.resolutionCompliancePct, 1)}%</b><div className="hint">Resolution SLA met</div></div>
              <div><b style={{ fontSize: 22, color: "#dc2626" }}>{data?.sla?.open?.red ?? 0}</b><div className="hint">Open & breached</div></div>
              <div><b style={{ fontSize: 22 }}>{data?.incidents?.mttrMinutes ? `${data.incidents.mttrMinutes} min` : "–"}</b><div className="hint">Mean time to resolve</div></div>
            </div>
          </div>
        </div>
      </div>
      {open && <IncidentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={reload} />}
    </Page>
  );
}
