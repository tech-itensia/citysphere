import { useState } from "react";
import { Page } from "../components/Layout";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { apiSend } from "../lib/api";
import { Icon } from "../components/Icon";
import { timeAgo } from "../lib/format";

/** City Admin: device API keys (for ingest-service), SLA policies, notification channels. */
export function Admin() {
  const { me } = useAuth();
  const tenant = me?.tenantId ?? "delhi";
  const { data: keys, reload } = useApi<any[]>(`/tenants/${tenant}/api-keys`);
  const { data: policies } = useApi<any>("/sla/policies");
  const { data: channels } = useApi<any[]>("/notifications/channels");
  const { data: sent } = useApi<any[]>("/notifications", 30_000);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string>();

  async function createKey() {
    const r = await apiSend<any>("POST", `/tenants/${tenant}/api-keys`, { name });
    setNewKey(r.key); setName(""); await reload();
  }

  return (
    <Page title="Administration" subtitle="Device API keys, SLA policies and notifications for this city.">
      <div className="grid cols-2">
        <div className="card">
          <h3><Icon name="KeyRound" size={17} /> Device / integrator API keys</h3>
          <p className="hint" style={{ marginTop: -6 }}>Use with <span className="mono">POST /v1/telemetry</span> on the ingest service (header <span className="mono">x-api-key</span>). Data goes straight to Kafka.</p>
          <div className="row" style={{ margin: "12px 0" }}>
            <label className="field" style={{ flex: 1 }}><input placeholder="Key name, e.g. Water SCADA gateway" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="btn primary" disabled={name.length < 2} onClick={createKey}><Icon name="Plus" size={15} /> Create</button>
          </div>
          {newKey && <div className="card" style={{ padding: 12, background: "#f0fdf4" }}><b>Copy now, shown once:</b><div className="mono" style={{ wordBreak: "break-all" }}>{newKey}</div></div>}
          <table className="tbl mt"><thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th></th></tr></thead><tbody>
            {(keys ?? []).map((k) => (
              <tr key={k.id}><td>{k.name}</td><td className="mono">{k.prefix}…</td><td>{timeAgo(k.created_at)}</td>
                <td>{k.revoked_at ? <span className="badge grey">revoked</span> : <button className="btn sm danger" onClick={async () => { await apiSend("DELETE", `/tenants/${tenant}/api-keys/${k.id}`); await reload(); }}>Revoke</button>}</td></tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <h3><Icon name="Clock" size={17} /> SLA policy (defaults)</h3>
          <table className="tbl"><thead><tr><th>Severity</th><th>Response</th><th>Resolution</th></tr></thead><tbody>
            {Object.entries(policies?.defaults ?? {}).map(([sev, p]: [string, any]) => (
              <tr key={sev}><td>{sev}</td><td>{p.responseMin} min</td><td>{Math.round(p.resolutionMin / 60)} h</td></tr>
            ))}
          </tbody></table>
          <p className="hint">Overrides per category: {(policies?.overrides ?? []).length}. Edit via <span className="mono">PUT /api/sla/policies</span>.</p>
        </div>
      </div>
      <div className="grid cols-2 mt">
        <div className="card">
          <h3><Icon name="Mail" size={17} /> Notification channels</h3>
          <table className="tbl"><thead><tr><th>Channel</th><th>Target</th><th>Events</th><th>Min severity</th></tr></thead><tbody>
            {(channels ?? []).map((c) => <tr key={c.id}><td>{c.channel}</td><td className="mono">{c.target}</td><td>{(c.events ?? []).join(", ")}</td><td>{c.min_severity}</td></tr>)}
          </tbody></table>
        </div>
        <div className="card">
          <h3><Icon name="Send" size={17} /> Recently sent</h3>
          {(sent ?? []).slice(0, 8).map((n) => (
            <div key={n.id} className="alert-item"><div className="t"><b>{n.subject}</b><span>{n.channel} → {n.recipient}</span></div><span className={`badge ${n.status === "sent" ? "green" : "red"}`}>{n.status}</span></div>
          ))}
          {!sent?.length && <div className="empty">Nothing sent yet</div>}
        </div>
      </div>
    </Page>
  );
}
