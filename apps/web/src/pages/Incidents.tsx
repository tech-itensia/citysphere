import { useMemo, useState } from "react";
import { Page } from "../components/Layout";
import { IncidentDrawer } from "../components/IncidentDrawer";
import { SeverityBadge, SlaBadge, StatusBadge } from "../components/Badges";
import { useApi } from "../lib/useApi";
import { useLive } from "../lib/live";
import { useAuth } from "../lib/auth";
import { DOMAINS, timeAgo, INCIDENT_STATUSES, downloadCsv } from "../lib/format";
import { Icon } from "../components/Icon";
import { NewIncidentModal } from "../components/QuickActions";

/** Incident list with filters, SLA status and the full lifecycle in a side drawer. Also used by Department Head. */
export function Incidents({ department, title = "Incidents" }: { department?: string; title?: string }) {
  const { me } = useAuth();
  const [status, setStatus] = useState("open");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [open, setOpen] = useState<string>();
  const [creating, setCreating] = useState(false);
  const params = new URLSearchParams({ limit: "300" });
  if (status === "open") params.set("open", "true"); else if (status) params.set("status", status);
  if (severity) params.set("severity", severity);
  if (category) params.set("category", category);
  if (department) params.set("department", department);
  if (source) params.set("source", source);
  const { data, reload } = useApi<any[]>(`/incidents?${params}`, 20_000);
  const ids = (data ?? []).slice(0, 80).map((i) => i.id).join(",");
  const { data: timers } = useApi<any[]>(ids ? `/sla/timers?incidentIds=${ids}` : null, 20_000);
  const timerOf = useMemo(() => new Map((timers ?? []).map((t) => [t.incidentId, t])), [timers]);
  useLive((e) => { if (e.event === "incident") void reload(); });
  const canCreate = me?.roles.some((r) => ["operator", "dept_head", "city_admin", "super_admin"].includes(r));

  return (
    <Page title={title} subtitle="Every incident from sensors, correlation rules, operators and citizens, with SLA tracking."
      actions={canCreate && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="Plus" size={16} /> New incident</button>}>
      <div className="card">
        <div className="filters">
          <label className="field">Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">All open</option><option value="">Any</option>
              {INCIDENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="field">Severity
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="">Any</option>{["Critical", "High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          <label className="field">Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Any</option>{Object.keys(DOMAINS).map((c) => <option key={c} value={c}>{DOMAINS[c].label}</option>)}</select>
          </label>
          <label className="field">Source
            <select value={source} onChange={(e) => setSource(e.target.value)}><option value="">Any</option><option value="alarm">Sensor alarm</option><option value="correlation">Correlation</option><option value="citizen">Citizen</option><option value="operator">Operator</option></select>
          </label>
          <span className="hint" style={{ marginLeft: "auto" }}>{data?.length ?? 0} incidents</span>
          <button className="btn sm" onClick={() => downloadCsv("incidents.csv", (data ?? []).map(({ ref, title, category, severity, status, source, zone, department, assignee, createdAt }) => ({ ref, title, category, severity, status, source, zone, department, assignee, createdAt })))}><Icon name="Download" size={14} /> CSV</button>
        </div>
        <div style={{ overflow: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Ref</th><th>Title</th><th>Severity</th><th>Status</th><th>SLA</th><th>Zone</th><th>Department</th><th>Assignee</th><th>Age</th></tr></thead>
            <tbody>
              {(data ?? []).map((i) => {
                const t = timerOf.get(i.id);
                return (
                  <tr key={i.id} className="click" onClick={() => setOpen(i.id)}>
                    <td className="mono">{i.ref}</td><td>{i.title}</td><td><SeverityBadge s={i.severity} /></td><td><StatusBadge s={i.status} /></td>
                    <td>{t ? <SlaBadge r={!t.responseMet ? t.response : t.resolution} /> : "–"}</td>
                    <td>{i.zone ?? "–"}</td><td>{i.department ?? "–"}</td><td>{i.assignee ?? "–"}</td><td>{timeAgo(i.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data?.length && <div className="empty">No incidents</div>}
        </div>
      </div>
      {open && <IncidentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={reload} />}
      {creating && <NewIncidentModal onClose={() => setCreating(false)} onCreated={() => void reload()} />}
    </Page>
  );
}
