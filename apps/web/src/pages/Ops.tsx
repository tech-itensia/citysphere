import { Page } from "../components/Layout";
import { useApi } from "../lib/useApi";
import { Icon } from "../components/Icon";
import { timeAgo } from "../lib/format";

/** IT / Platform Ops: service health, connectors, recent audit trail (SOW 4.2g, 5.5). */
export function Ops() {
  const { data: health } = useApi<any[]>("/system/health", 10_000);
  const { data: connectors } = useApi<any>("/connectors");
  const { data: audit } = useApi<any[]>("/audit?limit=50", 20_000);
  const up = (health ?? []).filter((s) => s.status === "up").length;

  return (
    <Page title="System Health" subtitle="Microservices, connectors, ingestion and the audit trail.">
      <div className="grid cols-3">
        <div className="card"><div className="hint">Services up</div><b style={{ fontSize: 28, color: up === health?.length ? "#16a34a" : "#dc2626" }}>{up} / {health?.length ?? "–"}</b></div>
        <div className="card"><div className="hint">Weather connector</div><b style={{ fontSize: 18 }}>{connectors?.weather?.provider ?? "–"}</b><div className="hint">every {connectors?.weather?.intervalMin ?? "–"} min</div></div>
        <div className="card"><div className="hint">Traffic feed</div><b style={{ fontSize: 18 }}>{connectors?.traffic?.provider ?? "–"}</b><div className="hint">Batch: {connectors?.batch?.endpoint ?? "–"}</div></div>
      </div>
      <div className="grid cols-2 mt">
        <div className="card">
          <h3><Icon name="Server" size={17} /> Microservices</h3>
          <table className="tbl"><thead><tr><th>Service</th><th>Status</th><th style={{ textAlign: "right" }}>Latency</th></tr></thead><tbody>
            {(health ?? []).map((s) => (
              <tr key={s.service}><td className="mono">{s.service}</td><td><span className={`badge ${s.status === "up" ? "green" : "red"}`}>{s.status}</span></td><td style={{ textAlign: "right" }}>{s.latencyMs ?? "–"} ms</td></tr>
            ))}
          </tbody></table>
          <p className="hint mt">Kafka topics, consumer lag and the dead-letter queues: <a href="http://localhost:8085" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>Kafka UI</a>. Outgoing email: <a href="http://localhost:8025" target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>Mailpit</a>.</p>
        </div>
        <div className="card">
          <h3><Icon name="Shield" size={17} /> Audit trail</h3>
          <div style={{ maxHeight: 460, overflow: "auto" }}>
            <table className="tbl"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead><tbody>
              {(audit ?? []).map((a, n) => <tr key={n}><td>{timeAgo(a.at)}</td><td>{a.actor}</td><td>{a.action}</td><td className="mono">{a.resource}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      </div>
    </Page>
  );
}
