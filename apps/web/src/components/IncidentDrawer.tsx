import { useState } from "react";
import { apiSend } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/format";
import { SeverityBadge, StatusBadge, SlaBadge } from "./Badges";
import { Icon } from "./Icon";

/** Allowed actions per status (mirrors services/incident-service/src/lifecycle.ts). */
const ACTIONS: Record<string, string[]> = {
  New: ["acknowledge", "assign", "escalate", "resolve"],
  Acknowledged: ["assign", "escalate", "resolve"],
  Assigned: ["start", "assign", "escalate", "resolve"],
  "In Progress": ["resolve", "assign", "escalate"],
  Reopened: ["acknowledge", "assign", "resolve"],
  Resolved: ["verify", "close", "reopen"],
  Verified: ["close", "reopen"],
  Closed: [],
};
const LABEL: Record<string, string> = {
  acknowledge: "Acknowledge", assign: "Assign", start: "Start work", resolve: "Resolve", verify: "Verify", close: "Close", reopen: "Reopen", escalate: "Escalate",
};

export function IncidentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const { me } = useAuth();
  const { data: inc, reload } = useApi<any>(`/incidents/${id}`);
  const { data: timers } = useApi<any[]>(`/sla/timers?incidentIds=${id}`, 15_000);
  const { data: wos, reload: reloadWos } = useApi<any[]>(`/work-orders?incidentId=${id}`);
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState("tech.delhi");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string>();
  const timer = timers?.[0];
  const canAct = !!me && !me.roles.includes("citizen") && !me.roles.every((r) => r === "leadership" || r === "analyst");

  async function act(action: string) {
    setBusy(true); setMsg(undefined);
    try {
      await apiSend("POST", `/incidents/${id}/transition`, { action, note: note || undefined, ...(action === "assign" ? { assignee } : {}) });
      setNote(""); await reload(); onChanged?.();
      setMsg(`${LABEL[action]} done`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function createWo() {
    if (!inc) return;
    setBusy(true);
    try {
      await apiSend("POST", "/work-orders", { incidentId: inc.id, title: `Fix: ${inc.title}`, priority: inc.severity, department: inc.department, assignee, description: inc.description });
      await reloadWos(); setMsg("Work order created");
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Incident details">
        <div className="row between">
          <span className="hint">{inc?.ref}</span>
          <button className="btn sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></button>
        </div>
        {!inc ? <div className="empty">Loading…</div> : (
          <>
            <h2 style={{ marginTop: 8 }}>{inc.title}</h2>
            <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <SeverityBadge s={inc.severity} /><StatusBadge s={inc.status} />
              {inc.escalationLevel > 0 && <span className="badge red">Escalated L{inc.escalationLevel}</span>}
              {timer && <><SlaBadge r={timer.response} label="Response" /><SlaBadge r={timer.resolution} label="Resolution" /></>}
            </div>
            <dl className="kv">
              <dt>Category</dt><dd style={{ textTransform: "capitalize" }}>{inc.category}</dd>
              <dt>Zone</dt><dd>{inc.zone ?? "–"}</dd>
              <dt>Asset</dt><dd className="mono">{inc.deviceId ?? "–"} {inc.deviceType ? `· ${inc.deviceType}` : ""}</dd>
              <dt>Department</dt><dd>{inc.department ?? "–"}</dd>
              <dt>Assignee</dt><dd>{inc.assignee ?? "Unassigned"}</dd>
              <dt>Source</dt><dd>{inc.source}</dd>
              <dt>Created</dt><dd>{new Date(inc.createdAt).toLocaleString()} ({timeAgo(inc.createdAt)})</dd>
              {timer && <><dt>Resolution due</dt><dd>{new Date(timer.resolutionDue).toLocaleString()}</dd></>}
            </dl>
            {inc.description && <p style={{ fontSize: 13, color: "var(--ink-2)" }}>{inc.description}</p>}

            {canAct && (ACTIONS[inc.status] ?? []).length > 0 && (
              <div className="card" style={{ padding: 14, marginTop: 10 }}>
                <div className="filters" style={{ marginBottom: 10 }}>
                  <label className="field" style={{ flex: 1 }}>Assignee
                    <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                      <option value="tech.delhi">tech.delhi (Field Technician)</option>
                      <option value="waterhead.delhi">waterhead.delhi (Water Dept)</option>
                      <option value="operator.delhi">operator.delhi</option>
                    </select>
                  </label>
                  <label className="field" style={{ flex: 2 }}>Note
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the timeline" />
                  </label>
                </div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {(ACTIONS[inc.status] ?? []).map((a) => (
                    <button key={a} className={`btn sm${a === "resolve" || a === "acknowledge" ? " primary" : ""}${a === "escalate" ? " danger" : ""}`} disabled={busy} onClick={() => act(a)}>
                      {LABEL[a]}
                    </button>
                  ))}
                  <button className="btn sm" disabled={busy} onClick={createWo}><Icon name="ClipboardList" size={14} /> Create work order</button>
                </div>
                {msg && <div className="hint" style={{ marginTop: 8 }}>{msg}</div>}
              </div>
            )}

            {wos && wos.length > 0 && (
              <div className="mt">
                <h3 style={{ fontSize: 14 }}>Work orders</h3>
                {wos.map((w) => (
                  <div key={w.id} className="alert-item"><div className="t"><b>{w.ref} · {w.title}</b><span>{w.assignee ?? "unassigned"}</span></div><StatusBadge s={w.status} /></div>
                ))}
              </div>
            )}

            <h3 className="mt" style={{ fontSize: 14 }}>Timeline</h3>
            <div className="timeline">
              {(inc.timeline ?? []).map((e: any, n: number) => (
                <div key={n} className="ev">
                  <b style={{ textTransform: "capitalize" }}>{String(e.type).replace(".", " ")}</b>{e.data?.to ? ` → ${e.data.to}` : ""} {e.data?.note ? `· ${e.data.note}` : ""}
                  <span>{e.actor} · {new Date(e.at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
