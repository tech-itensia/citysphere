import { Area, AreaChart, Bar as RBar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Page } from "../components/Layout";
import { useApi } from "../lib/useApi";
import { DOMAINS, SEV_COLOR, fmt } from "../lib/format";

/** Analyst / Leadership reporting (SOW 4.3 c/f): trends, SLA compliance, distribution by category and zone. */
export function Analytics() {
  const { data: trend } = useApi<any[]>("/incidents/trend?days=30", 60_000);
  const { data: stats } = useApi<any>("/incidents/stats", 30_000);
  const { data: sla } = useApi<any>("/sla/summary", 30_000);
  const axis = { fontSize: 11, fill: "#64748b" };

  return (
    <Page title="Analytics" subtitle="Incident trends, SLA compliance and where problems happen.">
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
    </Page>
  );
}
