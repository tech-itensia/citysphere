import { useState } from "react";
import { Page } from "../components/Layout";
import { SeverityBadge, StatusBadge } from "../components/Badges";
import { Icon } from "../components/Icon";
import { useApi } from "../lib/useApi";
import { useLive } from "../lib/live";
import { useAuth } from "../lib/auth";
import { apiSend } from "../lib/api";
import { timeAgo } from "../lib/format";

const LANES = ["Open", "Assigned", "Accepted", "In Progress", "On Hold", "Completed", "Verified", "Closed"];
const NEXT: Record<string, Array<[string, string]>> = {
  Open: [["assign", "Assign"]], Assigned: [["accept", "Accept"], ["start", "Start"]], Accepted: [["start", "Start"]],
  "In Progress": [["hold", "Hold"], ["complete", "Complete"]], "On Hold": [["resume", "Resume"]],
  Completed: [["verify", "Verify"], ["reject", "Reject"]], Verified: [["close", "Close"]],
};

/** Work orders as a board (SOW 4.5/4.6): assignment, progress, completion, verification, closure. */
export function WorkOrders() {
  const { data, reload } = useApi<any[]>("/work-orders", 20_000);
  useLive((e) => { if (e.event === "workorder") void reload(); });
  const [err, setErr] = useState<string>();

  async function move(id: string, action: string) {
    setErr(undefined);
    try { await apiSend("POST", `/work-orders/${id}/transition`, { action, ...(action === "assign" ? { assignee: "tech.delhi" } : {}) }); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <Page title="Work Orders" subtitle="Built-in work order management linked to incidents and SLAs.">
      {err && <div className="badge red" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="kanban">
        {LANES.map((lane) => {
          const items = (data ?? []).filter((w) => w.status === lane);
          return (
            <div key={lane} className="lane">
              <h4>{lane}<span>{items.length}</span></h4>
              {items.map((w) => (
                <div key={w.id} className="wo">
                  <div className="row between"><span className="mono hint">{w.ref}</span><SeverityBadge s={w.priority} /></div>
                  <b>{w.title}</b>
                  <div className="meta"><span>{w.assignee ?? "unassigned"}</span><span>{timeAgo(w.updatedAt ?? w.createdAt)}</span></div>
                  <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 6 }}>
                    {(NEXT[lane] ?? []).map(([a, l]) => <button key={a} className="btn sm" onClick={() => move(w.id, a)}>{l}</button>)}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </Page>
  );
}

/** Field technician: my jobs, large touch targets, checklist + photo evidence. */
export function Field() {
  const { me } = useAuth();
  const { data, reload } = useApi<any[]>("/work-orders?assignee=me", 20_000);
  const [note, setNote] = useState<Record<string, string>>({});
  const active = (data ?? []).filter((w) => !["Closed", "Cancelled", "Verified"].includes(w.status));

  async function act(w: any, action: string) {
    await apiSend("POST", `/work-orders/${w.id}/transition`, {
      action, note: note[w.id] || undefined,
      ...(action === "complete" ? { evidence: [{ type: "reading", value: note[w.id] || "Completed on site" }], checklist: (w.checklist ?? []).map((c: any) => ({ ...c, done: true })) } : {}),
    });
    await reload();
  }

  return (
    <Page title="My Jobs" subtitle={`Hello ${me?.displayName ?? ""}. Your assigned work orders for today.`}>
      <div className="grid cols-3">
        {active.map((w) => (
          <div key={w.id} className="card">
            <div className="row between"><span className="mono hint">{w.ref}</span><StatusBadge s={w.status} /></div>
            <h3 style={{ marginTop: 8 }}>{w.title}</h3>
            <div className="row" style={{ gap: 6 }}><SeverityBadge s={w.priority} /><span className="hint">{w.department}</span></div>
            {w.dueAt && <div className="hint mt" style={{ marginTop: 8 }}><Icon name="Clock" size={13} /> Due {new Date(w.dueAt).toLocaleString()}</div>}
            <div className="mt" style={{ marginTop: 12 }}>
              {(w.checklist ?? []).map((c: any, n: number) => (
                <div key={n} className="row" style={{ fontSize: 13, marginBottom: 4 }}><Icon name={c.done ? "Check" : "Minus"} size={14} color={c.done ? "#16a34a" : "#94a3b8"} />{c.item}</div>
              ))}
            </div>
            <label className="field" style={{ marginTop: 10 }}>Note / reading<input value={note[w.id] ?? ""} onChange={(e) => setNote({ ...note, [w.id]: e.target.value })} /></label>
            <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
              {w.status === "Assigned" && <button className="btn primary" onClick={() => act(w, "accept")}>Accept</button>}
              {(w.status === "Assigned" || w.status === "Accepted") && <button className="btn" onClick={() => act(w, "start")}>Start</button>}
              {w.status === "In Progress" && <><button className="btn primary" onClick={() => act(w, "complete")}><Icon name="Camera" size={15} /> Complete</button><button className="btn" onClick={() => act(w, "hold")}>Hold</button></>}
              {w.status === "On Hold" && <button className="btn" onClick={() => act(w, "resume")}>Resume</button>}
            </div>
          </div>
        ))}
        {!active.length && <div className="card empty">No open jobs. Nice work!</div>}
      </div>
    </Page>
  );
}
