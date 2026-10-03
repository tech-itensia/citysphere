import { Area, AreaChart, Bar as RBar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useState } from "react";
import { Page } from "../components/Layout";
import { Icon } from "../components/Icon";
import { Tabs, useTab } from "../components/Ui";
import { Bar } from "../components/Charts";
import { useApi } from "../lib/useApi";
import { apiGet } from "../lib/api";
import { DOMAINS, SEV_COLOR, fmt, downloadCsv, INCIDENT_STATUSES } from "../lib/format";

/** Analyst / Leadership reporting (SOW 4.3 c/f, D5.5): trends, SLA compliance, department scorecard and a report builder with CSV export. */
export function Analytics() {
  const [tab, setTab] = useTab("overview", ["overview", "departments", "builder"]);
  return (
    <Page title="Analytics & reports" subtitle="Trends, service levels, department performance and exportable reports.">
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview", icon: "BarChart3" }, { id: "departments", label: "Department scorecard", icon: "Building" }, { id: "builder", label: "Report builder", icon: "FileText" }]} />
      {tab === "overview" && <OverviewTab />}
      {tab === "departments" && <Scorecard />}
      {tab === "builder" && <Builder />}
    </Page>
  );
}

function Scorecard() {
  const { data } = useApi<any[]>("/incidents/departments", 60_000);
  const max = Math.max(1, ...(data ?? []).map((d) => d.total));
  return (
    <div className="card">
      <h3>Last 30 days by department <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => downloadCsv("department-scorecard.csv", data ?? [])}><Icon name="Download" size={14} /> CSV</button></h3>
      <table className="tbl"><thead><tr><th>Department</th><th>Volume</th><th>Open</th><th>Resolved</th><th>Escalated</th><th>Resolution rate</th><th>MTTR</th></tr></thead><tbody>
        {(data ?? []).map((d) => {
          const rate = d.total ? Math.round((d.resolved / d.total) * 100) : 0;
          return (
            <tr key={d.department}><td><b>{d.department}</b></td><td style={{ minWidth: 160 }}>{d.total}<Bar pct={(d.total / max) * 100} color="#4f46e5" /></td><td>{d.open}</td><td>{d.resolved}</td>
              <td>{d.escalated ? <span className="badge red">{d.escalated}</span> : 0}</td><td><span className={`badge ${rate >= 80 ? "green" : rate >= 50 ? "amber" : "red"}`}>{rate}%</span></td><td>{d.mttr_minutes ? `${d.mttr_minutes} min` : "–"}</td></tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

const DATASETS: Record<string, { label: string; path: (f: any) => string; cols: string[] }> = {
  incidents: { label: "Incidents", path: (f) => `/incidents?limit=1000&sort=recent${f.status ? `&status=${encodeURIComponent(f.status)}` : ""}${f.category ? `&category=${f.category}` : ""}${f.since ? `&since=${new Date(Date.now() - Number(f.since) * 86_400_000).toISOString()}` : ""}`, cols: ["ref", "title", "category", "severity", "status", "source", "zone", "department", "assignee", "createdAt", "resolvedAt", "closedAt"] },
  workorders: { label: "Work orders", path: () => "/work-orders", cols: ["ref", "title", "status", "priority", "department", "assignee", "dueAt", "createdAt", "completedAt"] },
  devices: { label: "Devices", path: () => "/assets/devices?limit=2000&includeDecommissioned=true", cols: ["deviceId", "name", "deviceType", "status", "zone", "siteName", "assetName", "department", "vendor", "serial", "protocol", "lastSeen"] },
};

function Builder() {
  const [f, setF] = useState({ dataset: "incidents", status: "", category: "", since: "30", group: "category" });
  const [rows, setRows] = useState<any[]>();
  const [busy, setBusy] = useState(false);
  const ds = DATASETS[f.dataset];
  async function run() { setBusy(true); try { setRows(await apiGet<any[]>(ds.path(f))); } finally { setBusy(false); } }
  const groups = rows ? Object.entries(rows.reduce((m: Record<string, number>, r) => { const k = String(r[f.group] ?? "–"); m[k] = (m[k] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]) : [];
  const max = Math.max(1, ...groups.map((g) => g[1]));
  return (
    <div className="grid main-side">
      <div className="card">
        <div className="filters">
          <label className="field">Dataset<select value={f.dataset} onChange={(e) => { setF({ ...f, dataset: e.target.value, group: DATASETS[e.target.value].cols[2] }); setRows(undefined); }}>{Object.entries(DATASETS).map(([k, d]) => <option key={k} value={k}>{d.label}</option>)}</select></label>
          {f.dataset === "incidents" && <>
            <label className="field">Period<select value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })}><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option><option value="">All</option></select></label>
            <label className="field">Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any</option>{INCIDENT_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">Category<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Any</option>{Object.keys(DOMAINS).map((c) => <option key={c} value={c}>{DOMAINS[c].label}</option>)}</select></label>
          </>}
          <label className="field">Group by<select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>{ds.cols.map((c) => <option key={c}>{c}</option>)}</select></label>
          <button className="btn primary" onClick={run} disabled={busy}><Icon name="Play" size={14} /> Run</button>
          {rows && <button className="btn" onClick={() => downloadCsv(`${f.dataset}-report.csv`, rows.map((r) => Object.fromEntries(ds.cols.map((c) => [c, r[c]]))))}><Icon name="Download" size={14} /> Export CSV ({rows.length})</button>}
        </div>
        {rows && (
          <div style={{ maxHeight: 460, overflow: "auto" }}>
            <table className="tbl"><thead><tr>{ds.cols.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>
              {rows.slice(0, 200).map((r, n) => <tr key={n}>{ds.cols.map((c) => <td key={c} style={{ fontSize: 12 }}>{String(r[c] ?? "")}</td>)}</tr>)}
            </tbody></table>
          </div>
        )}
        {!rows && <div className="empty">Choose a dataset and run the report</div>}
      </div>
      <div className="card">
        <h3>Grouped by {f.group}</h3>
        {groups.slice(0, 15).map(([k, n]) => <div key={k} style={{ marginBottom: 8 }}><div className="row between" style={{ fontSize: 13 }}><span>{k}</span><b>{n}</b></div><Bar pct={(n / max) * 100} color="#4f46e5" /></div>)}
        {!groups.length && <div className="hint">Run a report to see the breakdown</div>}
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data: trend } = useApi<any[]>("/incidents/trend?days=30", 60_000);
  const { data: stats } = useApi<any>("/incidents/stats", 30_000);
  const { data: sla } = useApi<any>("/sla/summary", 30_000);
  const axis = { fontSize: 11, fill: "#64748b" };

  return (
    <>
      <div className="grid cols-4">
        <div className="card"><div className="hint">Incidents (all time)</div><b style={{ fontSize: 26 }}>{fmt(stats?.total)}</b></div>
        <div className="card"><div className="hint">Mean time to resolve</div><b style={{ fontSize: 26 }}>{stats?.mttrMinutes ? `${stats.mttrMinutes} min` : "–"}</b></div>
        <div className="card"><div className="hint">Response SLA met (30 d)</div><b style={{ fontSize: 26 }}>{fmt(sla?.responseCompliancePct, 1)}%</b></div>
        <div className="card"><div className="hint">Resolution SLA met (30 d)</div><b style={{ fontSize: 26 }}>{fmt(sla?.resolutionCompliancePct, 1)}%</b></div>
      </div>

      <div className="card mt">
        <h3>Created vs resolved, last 30 days</h3>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <AreaChart data={trend ?? []} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2563eb" stopOpacity={0.3} /><stop offset="1" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
                <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22c55e" stopOpacity={0.3} /><stop offset="1" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(15,23,42,.06)" vertical={false} />
              <XAxis dataKey="day" tick={axis} tickFormatter={(d: string) => String(d).slice(5)} minTickGap={24} />
              <YAxis tick={axis} allowDecimals={false} />
              <Tooltip /><Legend />
              <Area type="monotone" dataKey="created" name="Created" stroke="#2563eb" fill="url(#gc)" strokeWidth={2} />
              <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#22c55e" fill="url(#gr)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid cols-3 mt">
        <div className="card">
          <h3>Open by category</h3>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={(stats?.byCategory ?? []).map((r: any) => ({ ...r, label: DOMAINS[r.key]?.label ?? r.key }))} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" tick={axis} allowDecimals={false} /><YAxis type="category" dataKey="label" tick={axis} width={100} />
                <Tooltip />
                <RBar dataKey="count" radius={[0, 6, 6, 0]}>
                  {(stats?.byCategory ?? []).map((r: any) => <Cell key={r.key} fill={DOMAINS[r.key]?.color ?? "#94a3b8"} />)}
                </RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3>Open by severity</h3>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={stats?.bySeverity ?? []}>
                <XAxis dataKey="key" tick={axis} /><YAxis tick={axis} allowDecimals={false} /><Tooltip />
                <RBar dataKey="count" radius={[6, 6, 0, 0]}>{(stats?.bySeverity ?? []).map((r: any) => <Cell key={r.key} fill={SEV_COLOR[r.key] ?? "#94a3b8"} />)}</RBar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3>Open by zone</h3>
          <table className="tbl"><tbody>
            {(stats?.byZone ?? []).map((r: any) => <tr key={r.key}><td>{r.key}</td><td style={{ textAlign: "right" }}><b>{r.count}</b></td></tr>)}
          </tbody></table>
          <h3 className="mt">Open SLA status</h3>
          <div className="row" style={{ gap: 18 }}>
            <span><b style={{ color: "#16a34a", fontSize: 20 }}>{sla?.open?.green ?? 0}</b> <span className="hint">on track</span></span>
            <span><b style={{ color: "#d97706", fontSize: 20 }}>{sla?.open?.amber ?? 0}</b> <span className="hint">near breach</span></span>
            <span><b style={{ color: "#dc2626", fontSize: 20 }}>{sla?.open?.red ?? 0}</b> <span className="hint">breached</span></span>
          </div>
        </div>
      </div>
    </>
  );
}
