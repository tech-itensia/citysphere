import { useNavigate } from "react-router-dom";
import { Page } from "../components/Layout";
import { useApi } from "../lib/useApi";
import { Icon } from "../components/Icon";
import { Kpi, Tabs, useTab } from "../components/Ui";
import { DeviceStatusBadge } from "../components/Badges";
import { timeAgo, fmt } from "../lib/format";

const PIPELINE = [
  ["Sources", "Radio", "devices, vendor clouds, open data"], ["ingest / connectors", "Send", "HTTP + API key, pulls, CSV"], ["Kafka", "Workflow", "raw → normalized → alerts"],
  ["normalizer", "GitBranch", "mapping profiles + registry"], ["ThingsBoard", "Cpu", "profiles, alarm rules, time series"], ["incident / SLA", "AlertTriangle", "lifecycle, timers, routing"],
];

/** IT / Platform Ops: service health, the ingestion pipeline, device connectivity, connectors and the audit trail (SOW 4.2g, 5.5). */
export function Ops() {
  const nav = useNavigate();
  const [tab, setTab] = useTab("health", ["health", "ingestion", "audit"]);
  const { data: health } = useApi<any[]>("/system/health", 10_000);
  const { data: connectors } = useApi<any>("/connectors");
  const { data: audit } = useApi<any[]>(tab === "audit" ? "/audit?limit=100" : null, 20_000);
  const { data: assets } = useApi<any>("/assets/summary", 30_000);
  const { data: offline } = useApi<any[]>(tab === "ingestion" ? "/assets/devices?offline=true&limit=200" : null, 30_000);
  const up = (health ?? []).filter((s) => s.status === "up").length;
  const slow = (health ?? []).filter((s) => s.latencyMs > 500).length;

  return (
    <Page title="System health" subtitle="Microservices, the ingestion pipeline, device connectivity and the audit trail.">
      <div className="grid cols-6k">
        <Kpi label="Services up" icon="Server" value={`${up} / ${health?.length ?? "–"}`} tone={health && up === health.length ? "#16a34a" : "#dc2626"} sub={slow ? `${slow} slow (>500 ms)` : "all responsive"} />
        <Kpi label="Devices online" icon="Wifi" value={fmt(assets?.online)} sub={`of ${fmt(assets?.registered)} registered`} />
        <Kpi label="Devices offline" icon="WifiOff" value={fmt(assets?.offline)} tone={assets?.offline ? "#ea580c" : undefined} />
        <Kpi label="Unmapped senders" icon="Radio" value={fmt(assets?.discovered)} sub={<a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => nav("/assets#discovered")}>Open queue</a>} />
        <Kpi label="Weather connector" icon="CloudRain" value={connectors?.weather?.provider ?? "–"} sub={`every ${connectors?.weather?.intervalMin ?? "–"} min`} />
        <Kpi label="Traffic feed" icon="Car" value={connectors?.traffic?.provider ?? "–"} sub={connectors?.batch?.endpoint} />
      </div>
      <div className="mt">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "health", label: "Services", icon: "Server" }, { id: "ingestion", label: "Ingestion & connectivity", icon: "Workflow" }, { id: "audit", label: "Audit trail", icon: "Shield" }]} />
      </div>
      {tab === "health" && (
        <div className="grid cols-2">
          <div className="card">
            <h3><Icon name="Server" size={17} /> Microservices</h3>
            <table className="tbl"><thead><tr><th>Service</th><th>Status</th><th style={{ textAlign: "right" }}>Latency</th></tr></thead><tbody>
              {(health ?? []).map((s) => (
                <tr key={s.service}><td className="mono">{s.service}</td><td><span className={`badge ${s.status === "up" ? "green" : "red"}`}>{s.status}</span></td><td style={{ textAlign: "right" }}>{s.latencyMs ?? "–"} ms</td></tr>
              ))}
            </tbody></table>
          </div>
          <div className="card">
            <h3><Icon name="Monitor" size={17} /> Tools</h3>
            <div className="check"><Icon name="Workflow" size={18} color="#4f46e5" /><div><b>Kafka UI</b><div className="hint">Topics, consumer lag, dead-letter queues (scaas.dlq.*)</div><a href="http://localhost:8085" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>localhost:8085</a></div></div>
            <div className="check"><Icon name="Cpu" size={18} color="#0ea5e9" /><div><b>ThingsBoard</b><div className="hint">Device profiles, rule chains, raw telemetry</div><a href="http://localhost:8080" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>localhost:8080</a></div></div>
            <div className="check"><Icon name="Lock" size={18} color="#64748b" /><div><b>Keycloak</b><div className="hint">Realm scaas: users, roles, city groups</div><a href="http://localhost:8180" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>localhost:8180</a></div></div>
            <div className="check"><Icon name="Mail" size={18} color="#22c55e" /><div><b>Mailpit</b><div className="hint">Every outgoing notification email in development</div><a href="http://localhost:8025" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>localhost:8025</a></div></div>
          </div>
        </div>
      )}
      {tab === "ingestion" && (
        <>
          <div className="card">
            <h3><Icon name="Workflow" size={16} /> Data path</h3>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {PIPELINE.map(([name, icon, sub], n) => (
                <div key={name} className="row" style={{ gap: 8 }}>
                  <div className="card" style={{ padding: 12, minWidth: 150 }}><div className="row" style={{ gap: 6 }}><Icon name={icon} size={16} color="#4f46e5" /><b>{name}</b></div><div className="hint">{sub}</div></div>
                  {n < PIPELINE.length - 1 && <Icon name="ArrowRight" size={16} color="#94a3b8" />}
                </div>
              ))}
            </div>
          </div>
          <div className="card mt">
            <h3><Icon name="WifiOff" size={16} /> Offline devices (no data for 15 min)</h3>
            <div style={{ maxHeight: 420, overflow: "auto" }}>
              <table className="tbl"><thead><tr><th>Device</th><th>Type</th><th>Where</th><th>Department</th><th>Status</th><th>Last seen</th></tr></thead><tbody>
                {(offline ?? []).map((d) => <tr key={d.deviceId}><td className="mono">{d.deviceId}</td><td>{d.deviceType}</td><td>{[d.zone, d.siteName].filter(Boolean).join(" › ")}</td><td>{d.department ?? "–"}</td><td><DeviceStatusBadge s={d.status} /></td><td>{d.lastSeen ? timeAgo(d.lastSeen) : "never"}</td></tr>)}
              </tbody></table>
              {!offline?.length && <div className="empty">Every registered device reported in the last 15 minutes</div>}
            </div>
          </div>
        </>
      )}
      {tab === "audit" && (
        <div className="card">
          <h3><Icon name="Shield" size={17} /> Audit trail <span className="hint" style={{ marginLeft: 8 }}>append-only</span></h3>
          <div style={{ maxHeight: 560, overflow: "auto" }}>
            <table className="tbl"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead><tbody>
              {(audit ?? []).map((a, n) => <tr key={n}><td>{timeAgo(a.at)}</td><td>{a.actor}</td><td>{a.action}</td><td className="mono">{a.resource}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      )}
    </Page>
  );
}
