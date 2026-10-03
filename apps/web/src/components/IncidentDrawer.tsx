import { useState } from "react";
import { apiSend } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { ACTION_LABEL, CLOSURE_CODES, domainOf, fmt, timeAgo } from "../lib/format";
import { SeverityBadge, StatusBadge, SlaBadge } from "./Badges";
import { Countdown } from "./Ui";
import { Icon } from "./Icon";

const EVENT_ICON: Record<string, [string, string]> = {
  created: ["Radio", "#2563eb"], "status.changed": ["ArrowRight", "#4f46e5"], escalated: ["AlertTriangle", "#dc2626"], comment: ["MessageSquare", "#64748b"],
  "alarm.merged": ["GitBranch", "#64748b"], "source.cleared": ["Check", "#16a34a"], "severity.raised": ["AlertTriangle", "#ea580c"],
};
const ASSIGNEES = [["tech.delhi", "tech.delhi (Field Technician)"], ["waterhead.delhi", "waterhead.delhi (Water Dept Head)"], ["operator.delhi", "operator.delhi (Operator)"], ["operator2.delhi", "operator2.delhi (Night operator)"]];

/** Incident detail: asset chain with live values, both SLA clocks, role-aware lifecycle actions, work orders and the full timeline (D4.9, D5.4, D5.7). */
export function IncidentDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const { me } = useAuth();
  const { data: inc, reload, setData } = useApi<any>(`/incidents/${id}`, 20_000);
  const staff = !!me && !me.roles.every((r) => r === "citizen");
  const { data: timers } = useApi<any[]>(staff ? `/sla/timers?incidentIds=${id}` : null, 15_000);
  const { data: wos, reload: reloadWos } = useApi<any[]>(staff ? `/work-orders?incidentId=${id}` : null);
  const { data: depts } = useApi<any[]>(staff ? "/departments" : null);
  const { data: twin } = useApi<any>(staff && inc?.deviceId ? `/twin/devices/${encodeURIComponent(inc.deviceId)}` : null, 15_000);
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState("tech.delhi");
  const [department, setDepartment] = useState("");
  const [note, setNote] = useState("");
  const [closure, setClosure] = useState("duplicate");
  const [rating, setRating] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const timer = timers?.[0];
  const actions: string[] = inc?.allowedActions ?? [];
  const meta = domainOf(inc?.category);

  async function act(action: string) {
    setBusy(true); setMsg(undefined);
    try {
      const updated = await apiSend<any>("POST", `/incidents/${id}/transition`, {
        action, note: note || undefined,
        ...(action === "assign" ? { assignee: assignee || undefined, department: department || undefined } : {}),
        ...(action === "dismiss" ? { closureCode: closure } : {}),
        ...(rating && (action === "confirm" || action === "reopen") ? { rating } : {}),
      });
      setNote(""); if (updated?.id) setData((d: any) => ({ ...d, ...updated })); await reload(); onChanged?.();
      setMsg({ ok: true, text: `${ACTION_LABEL[action] ?? action} done` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function createWo() {
    if (!inc) return;
    setBusy(true);
    try {
      await apiSend("POST", "/work-orders", { incidentId: inc.id, title: `Fix: ${inc.title}`, priority: inc.severity, department: inc.department, assignee, description: inc.description,
        checklist: [{ item: "Inspect asset on site", done: false }, { item: "Isolate and make safe", done: false }, { item: "Repair or replace", done: false }, { item: "Confirm readings normal", done: false }] });
      await reloadWos(); setMsg({ ok: true, text: "Work order created and assigned" });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function comment() {
    if (!note.trim()) return;
    await apiSend("POST", `/incidents/${id}/comments`, { note });
    setNote(""); await reload();
  }

  async function advisory() {
    if (!inc) return;
    await apiSend("POST", "/advisories", { title: inc.title, body: `The city is responding to this ${inc.category} issue${inc.zone ? ` in ${inc.zone}` : ""}. Expect disruption nearby.`, category: inc.category, level: inc.severity === "Critical" ? "critical" : "warning", zone: inc.zone, lat: inc.lat, lon: inc.lon, incidentId: inc.id, hours: 4 });
    setMsg({ ok: true, text: "Advisory published to the citizen portal" });
  }

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Incident details">
        <div className="row between">
          <span className="hint mono">{inc?.ref}</span>
          <button className="btn sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></button>
        </div>
        {!inc ? <div className="empty">Loading…</div> : (
          <>
            <h2 style={{ marginTop: 8 }} className="row"><Icon name={meta.icon} color={meta.color} size={20} />{inc.title}</h2>
            <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
              <SeverityBadge s={inc.severity} /><StatusBadge s={inc.status} />
              {inc.escalationLevel > 0 && <span className="badge red">Escalated L{inc.escalationLevel}</span>}
              <span className="badge grey" style={{ textTransform: "capitalize" }}>{inc.source}</span>
              {inc.closureCode && <span className="badge grey">Dismissed: {inc.closureCode.replace("_", " ")}</span>}
            </div>

            {staff && timer && (
              <div className="grid cols-2 mt" style={{ gap: 10 }}>
                <div className="card" style={{ padding: 12 }}><div className="hint">Response SLA</div><div className="row between"><Countdown to={timer.responseDue} met={timer.responseMet} /><SlaBadge r={timer.response} /></div></div>
                <div className="card" style={{ padding: 12 }}><div className="hint">Resolution SLA</div><div className="row between"><Countdown to={timer.resolutionDue} met={timer.resolutionMet} /><SlaBadge r={timer.resolution} /></div></div>
              </div>
            )}

            {(inc.zone || inc.site || inc.asset || inc.deviceId) && (
              <div className="card mt" style={{ padding: 12 }}>
                <div className="hint" style={{ marginBottom: 6 }}>Asset chain</div>
                <div className="chain">
                  {[inc.zone, inc.site, inc.asset, inc.deviceId].filter(Boolean).map((x: string, n: number, arr: string[]) => (
                    <span key={n} className="row" style={{ gap: 6 }}><b className={n === arr.length - 1 ? "mono" : ""}>{x}</b>{n < arr.length - 1 && <span className="sep">›</span>}</span>
                  ))}
                </div>
                {twin?.state?.values && (
                  <div className="row mt" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    {Object.entries(twin.state.values).filter(([k]) => k !== "ingestSource").slice(0, 6).map(([k, v]) => (
                      <span key={k} className="badge blue">{k}: {typeof v === "number" ? fmt(v, 1) : String(v)}</span>
                    ))}
                    <span className="hint">live · {timeAgo(twin.state.ts)}</span>
                  </div>
                )}
              </div>
            )}

            <dl className="kv">
              <dt>Category</dt><dd style={{ textTransform: "capitalize" }}>{inc.category}</dd>
              {staff && <><dt>Department</dt><dd>{inc.department ?? "–"}</dd></>}
              {staff && <><dt>Assignee</dt><dd>{inc.assignee ?? "Unassigned"}</dd></>}
              <dt>Reported</dt><dd>{new Date(inc.createdAt).toLocaleString()} ({timeAgo(inc.createdAt)})</dd>
              {inc.resolvedAt && <><dt>Resolved</dt><dd>{new Date(inc.resolvedAt).toLocaleString()}</dd></>}
            </dl>
            {inc.description && <p style={{ fontSize: 13, color: "var(--ink-2)" }}>{inc.description}</p>}
            {inc.photos?.length > 0 && <div className="photo-thumbs">{inc.photos.map((p: any, n: number) => p.dataUrl ? <img key={n} src={p.dataUrl} alt={p.name} /> : <span key={n} className="badge grey">{p.name}</span>)}</div>}

            {actions.length > 0 && (
              <div className="card" style={{ padding: 14, marginTop: 12 }}>
                <div className="hint" style={{ marginBottom: 8 }}>Next step</div>
                {actions.includes("assign") && (
                  <div className="filters" style={{ marginBottom: 10 }}>
                    <label className="field" style={{ flex: 1 }}>Assign to person
                      <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                        <option value="">— department queue —</option>
                        {ASSIGNEES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    <label className="field" style={{ flex: 1 }}>Department
                      <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                        <option value="">Keep {inc.department ?? "current"}</option>
                        {(depts ?? []).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                {actions.includes("dismiss") && (
                  <label className="field" style={{ marginBottom: 10 }}>Dismiss reason
                    <select value={closure} onChange={(e) => setClosure(e.target.value)}>{CLOSURE_CODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  </label>
                )}
                {!staff && actions.includes("confirm") && (
                  <div className="row" style={{ marginBottom: 10 }}><span className="hint">Rate the fix</span>
                    {[1, 2, 3, 4, 5].map((n) => <button key={n} className="btn sm" style={{ padding: "4px 6px" }} onClick={() => setRating(n)} aria-label={`${n} stars`}><Icon name="Star" size={15} color={n <= rating ? "#f59e0b" : "#cbd5e1"} /></button>)}
                  </div>
                )}
                <label className="field">Note {staff ? "(goes on the timeline)" : "(optional)"}
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={staff ? "e.g. Crew dispatched from KB depot" : "Anything the city should know"} />
                </label>
                <div className="row" style={{ flexWrap: "wrap", marginTop: 10 }}>
                  {actions.map((a) => (
                    <button key={a} className={`btn sm${["acknowledge", "confirm", "resolve", "complete", "start"].includes(a) ? " primary" : ""}${["escalate", "dismiss"].includes(a) ? " danger" : ""}`} disabled={busy} onClick={() => act(a)}>
                      {ACTION_LABEL[a] ?? a}
                    </button>
                  ))}
                </div>
                {staff && (
                  <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
                    <button className="btn sm" disabled={busy} onClick={createWo}><Icon name="ClipboardList" size={14} /> Create work order</button>
                    <button className="btn sm" disabled={busy || !note.trim()} onClick={comment}><Icon name="MessageSquare" size={14} /> Add note only</button>
                    {me?.roles.some((r) => ["operator", "dept_head", "city_admin", "super_admin"].includes(r)) && <button className="btn sm" onClick={advisory}><Icon name="Megaphone" size={14} /> Advise citizens</button>}
                  </div>
                )}
              </div>
            )}
            {msg && <div className={`badge ${msg.ok ? "green" : "red"}`} style={{ marginTop: 8, display: "inline-block" }}>{msg.text}</div>}

            {wos && wos.length > 0 && (
              <div className="mt">
                <h3 style={{ fontSize: 14 }}>Work orders</h3>
                {wos.map((w) => (
                  <div key={w.id} className="alert-item"><div className="t"><b>{w.ref} · {w.title}</b><span>{w.assignee ?? "unassigned"} · {(w.checklist ?? []).filter((c: any) => c.done).length}/{(w.checklist ?? []).length} checklist</span></div><StatusBadge s={w.status} /></div>
                ))}
              </div>
            )}

            <h3 className="mt" style={{ fontSize: 14 }}>Timeline: sensor → alert → action → closure</h3>
            <div className="timeline">
              {(inc.timeline ?? []).map((e: any, n: number) => {
                const [icon, color] = EVENT_ICON[e.type] ?? ["Activity", "#64748b"];
                return (
                  <div key={n} className="ev">
                    <b className="row" style={{ gap: 6 }}><Icon name={icon} size={13} color={color} /><span style={{ textTransform: "capitalize" }}>{String(e.type).replace(".", " ")}</span>{e.data?.to ? ` → ${e.data.to}` : ""}</b>
                    {(e.data?.note || e.data?.assignee || e.data?.closureCode) && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{[e.data.assignee && `to ${e.data.assignee}`, e.data.closureCode && `reason: ${e.data.closureCode}`, e.data.note].filter(Boolean).join(" · ")}</div>}
                    <span>{e.actor} · {new Date(e.at).toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </aside>
    </>
  );
}
