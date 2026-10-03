import { useState } from "react";
import { Page } from "../components/Layout";
import { Icon } from "../components/Icon";
import { IncidentDrawer } from "../components/IncidentDrawer";
import { SeverityBadge, StatusBadge, DeviceStatusBadge } from "../components/Badges";
import { Countdown, Kpi } from "../components/Ui";
import { Bar } from "../components/Charts";
import { CityMap } from "../components/CityMap";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { useLive } from "../lib/live";
import { apiSend } from "../lib/api";
import { SEV_COLOR, fmt, timeAgo } from "../lib/format";

/** Department Head: my department's queue, SLA risk, crew workload, work orders and the health of the assets we own. */
export function Department() {
  const { me } = useAuth();
  const { data: depts } = useApi<any[]>("/departments");
  const mine = (depts ?? []).find((d) => me?.departments?.includes(d.id)) ?? (depts ?? []).find((d) => d.id === "water");
  const [pick, setPick] = useState<string>();
  const name = pick ?? mine?.name;
  const q = name ? `department=${encodeURIComponent(name)}` : null;
  const { data: stats, reload: reloadStats } = useApi<any>(q ? `/incidents/stats?${q}` : null, 30_000);
  const { data: incidents, reload } = useApi<any[]>(q ? `/incidents?open=true&limit=200&${q}` : null, 20_000);
  const { data: wos, reload: reloadWos } = useApi<any[]>(q ? `/work-orders?${q}` : null, 30_000);
  const { data: devices } = useApi<any[]>(q ? `/assets/devices?${q}&limit=2000` : null, 60_000);
  const { data: atRisk } = useApi<any[]>("/sla/at-risk?limit=100", 15_000);
  const [open, setOpen] = useState<string>();
  useLive((e) => { if (e.event === "incident" || e.event === "workorder") { void reload(); void reloadWos(); void reloadStats(); } });

  const ids = new Set((incidents ?? []).map((i) => i.id));
  const risk = (atRisk ?? []).filter((t) => ids.has(t.incidentId)).slice(0, 8);
  const crew = (stats?.byAssignee ?? []) as Array<{ key: string; count: number }>;
  const maxCrew = Math.max(1, ...crew.map((c) => c.count));
  const health = { active: (devices ?? []).filter((d) => d.status === "Active").length, offline: (devices ?? []).filter((d) => !d.online && !["Discovered", "Decommissioned"].includes(d.status)).length, faulty: (devices ?? []).filter((d) => d.status === "Faulty").length, maintenance: (devices ?? []).filter((d) => d.status === "Maintenance").length };
  const pendingVerify = (wos ?? []).filter((w) => w.status === "Completed");
  const unassigned = (incidents ?? []).filter((i) => !i.assignee && ["New", "Acknowledged"].includes(i.status));

  async function verify(id: string, action: "verify" | "reject") { await apiSend("POST", `/work-orders/${id}/transition`, { action }); await reloadWos(); }

  return (
    <Page title={name ? `${name} department` : "My department"} subtitle="Your queue, service levels, crews and assets in one place."
      actions={(me?.roles.includes("super_admin") || me?.roles.includes("city_admin")) && <select className="btn" value={name ?? ""} onChange={(e) => setPick(e.target.value)}>{(depts ?? []).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}</select>}>
      <div className="grid cols-6k">
        <Kpi label="Open incidents" icon="AlertTriangle" value={fmt(stats?.open)} sub={`${stats?.createdToday ?? 0} new today`} />
        <Kpi label="Unassigned" icon="UserPlus" value={unassigned.length} tone={unassigned.length ? "#ea580c" : undefined} />
        <Kpi label="Escalated" icon="Flag" value={fmt(stats?.escalated)} tone={stats?.escalated ? "#dc2626" : undefined} />
        <Kpi label="Mean time to resolve" icon="Clock" value={stats?.mttrMinutes ? `${stats.mttrMinutes} min` : "–"} sub={stats?.mttaMinutes ? `ack in ${stats.mttaMinutes} min` : undefined} />
        <Kpi label="Work done, to verify" icon="ListChecks" value={pendingVerify.length} />
        <Kpi label="Our assets online" icon="Cpu" value={devices?.length ? `${Math.round(((devices.length - health.offline) / devices.length) * 100)}%` : "–"} sub={`${health.faulty} faulty · ${health.maintenance} in maintenance`} />
      </div>
      <div className="grid main-side mt">
        <div className="card">
          <h3>Queue <span className="hint" style={{ marginLeft: "auto" }}>{incidents?.length ?? 0} open</span></h3>
          <div style={{ maxHeight: 460, overflow: "auto" }}>
            <table className="tbl"><thead><tr><th>Ref</th><th>Title</th><th>Severity</th><th>Status</th><th>Zone</th><th>Assignee</th><th>Age</th></tr></thead><tbody>
              {(incidents ?? []).map((i) => (
                <tr key={i.id} className="click" onClick={() => setOpen(i.id)}><td className="mono">{i.ref}</td><td>{i.title}</td><td><SeverityBadge s={i.severity} /></td><td><StatusBadge s={i.status} /></td><td>{i.zone ?? "–"}</td><td>{i.assignee ?? <span className="badge amber">unassigned</span>}</td><td>{timeAgo(i.createdAt)}</td></tr>
              ))}
            </tbody></table>
            {!incidents?.length && <div className="empty">Queue is clear</div>}
          </div>
        </div>
        <div className="stack">
          <div className="card">
            <h3><Icon name="Clock" size={16} /> SLA at risk</h3>
            {risk.map((t) => { const i = (incidents ?? []).find((x) => x.id === t.incidentId); return (
              <div key={`${t.incidentId}${t.clock}`} className="alert-item" onClick={() => setOpen(t.incidentId)}><span className="sevdot" style={{ background: SEV_COLOR[t.severity] }} /><div className="t"><b>{i?.title}</b><span style={{ textTransform: "capitalize" }}>{t.clock}</span></div><Countdown to={t.dueAt} /></div>
            ); })}
            {!risk.length && <div className="empty">Nothing close to breach</div>}
          </div>
          <div className="card">
            <h3><Icon name="Users" size={16} /> Crew workload</h3>
            {crew.map((c) => <div key={c.key} style={{ marginBottom: 8 }}><div className="row between" style={{ fontSize: 13 }}><span>{c.key}</span><b>{c.count}</b></div><Bar pct={(c.count / maxCrew) * 100} color={c.key === "Unassigned" ? "#f97316" : "#4f46e5"} /></div>)}
            {!crew.length && <div className="empty">No open work</div>}
          </div>
        </div>
      </div>
      <div className="grid cols-2 mt">
        <div className="card">
          <h3><Icon name="ListChecks" size={16} /> Work done, waiting for your verification</h3>
          {pendingVerify.map((w) => (
            <div key={w.id} className="alert-item">
              <div className="t"><b>{w.ref} · {w.title}</b><span>{w.assignee} · {(w.checklist ?? []).filter((c: any) => c.done).length}/{(w.checklist ?? []).length} checklist · {(w.evidence ?? []).length} evidence</span></div>
              <button className="btn sm primary" onClick={() => verify(w.id, "verify")}>Verify</button><button className="btn sm" onClick={() => verify(w.id, "reject")}>Send back</button>
            </div>
          ))}
          {!pendingVerify.length && <div className="empty">Nothing to verify</div>}
          <h3 className="mt" style={{ fontSize: 14 }}>All work orders</h3>
          {(wos ?? []).filter((w) => !["Closed", "Cancelled", "Completed"].includes(w.status)).slice(0, 8).map((w) => <div key={w.id} className="alert-item"><div className="t"><b>{w.ref} · {w.title}</b><span>{w.assignee ?? "unassigned"} · due {w.dueAt ? timeAgo(w.dueAt) : "–"}</span></div><StatusBadge s={w.status} /></div>)}
        </div>
        <div className="card">
          <h3><Icon name="Cpu" size={16} /> Assets we own ({devices?.length ?? 0})</h3>
          <CityMap center={me?.city?.center ?? { lat: 28.6139, lon: 77.209 }} height={300} showLegend={false} live={false} devices={(devices ?? []).map((d) => ({ ...d, alarms: d.status === "Faulty" ? ["fault"] : [] }))} />
          {(devices ?? []).filter((d) => ["Faulty", "Maintenance"].includes(d.status) || !d.online).slice(0, 6).map((d) => <div key={d.deviceId} className="alert-item"><div className="t"><b className="mono">{d.deviceId}</b><span>{d.siteName ?? d.zone} · last seen {timeAgo(d.lastSeen)}</span></div><DeviceStatusBadge s={d.status} /></div>)}
        </div>
      </div>
      {open && <IncidentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={reload} />}
    </Page>
  );
}
