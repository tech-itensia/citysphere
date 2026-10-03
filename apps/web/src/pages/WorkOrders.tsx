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

/** Field technician (mobile first): my jobs by due time, checklist, notes and photo evidence, directions, and commissioning devices on site. */
export function Field() {
  const { me } = useAuth();
  const { data, reload } = useApi<any[]>("/work-orders?assignee=me", 20_000);
  const [tab, setTab] = useState<"jobs" | "commission">("jobs");
  const active = (data ?? []).filter((w) => !["Closed", "Cancelled", "Verified"].includes(w.status))
    .sort((a, b) => (a.dueAt ?? "9") < (b.dueAt ?? "9") ? -1 : 1);
  return (
    <Page title="My jobs" subtitle={`Hello ${me?.displayName ?? ""}. ${active.length} open job${active.length === 1 ? "" : "s"} today.`}>
      <div className="seg" style={{ marginBottom: 16 }}>
        <button className={tab === "jobs" ? "on" : ""} onClick={() => setTab("jobs")}>Jobs ({active.length})</button>
        <button className={tab === "commission" ? "on" : ""} onClick={() => setTab("commission")}>Commission a device</button>
      </div>
      {tab === "jobs" ? (
        <div className="grid cols-3">
          {active.map((w) => <JobCard key={w.id} w={w} onChanged={reload} />)}
          {!active.length && <div className="card empty">No open jobs. Nice work!</div>}
        </div>
      ) : <Commission />}
    </Page>
  );
}

async function photo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, 800 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.7);
}

function JobCard({ w, onChanged }: { w: any; onChanged: () => void }) {
  const [checklist, setChecklist] = useState<any[]>(w.checklist ?? []);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [err, setErr] = useState<string>();
  async function act(action: string) {
    setErr(undefined);
    try {
      await apiSend("POST", `/work-orders/${w.id}/transition`, {
        action, note: note || undefined, checklist,
        ...(action === "complete" ? { evidence: [...photos.map((url) => ({ type: "photo", url })), ...(note ? [{ type: "reading", value: note }] : [])] } : {}),
      });
      setNote(""); setPhotos([]); onChanged();
    } catch (e) { setErr((e as Error).message); }
  }
  const allDone = checklist.length === 0 || checklist.every((c) => c.done);
  const overdue = w.dueAt && new Date(w.dueAt).getTime() < Date.now();
  return (
    <div className="card">
      <div className="row between"><span className="mono hint">{w.ref}</span><StatusBadge s={w.status} /></div>
      <h3 style={{ marginTop: 8 }}>{w.title}</h3>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><SeverityBadge s={w.priority} /><span className="hint">{w.department}</span>{w.zone && <span className="hint">· {w.zone}</span>}</div>
      {w.dueAt && <div className="hint" style={{ marginTop: 8, color: overdue ? "#dc2626" : undefined }}><Icon name="Clock" size={13} /> Due {new Date(w.dueAt).toLocaleString()}{overdue ? " (overdue)" : ""}</div>}
      {w.lat && <a className="btn sm" style={{ marginTop: 8 }} target="_blank" rel="noreferrer" href={`https://www.google.com/maps/dir/?api=1&destination=${w.lat},${w.lon}`}><Icon name="Navigation" size={14} /> Directions</a>}
      <div style={{ marginTop: 12 }}>
        {checklist.map((c, n) => (
          <label key={n} className="row" style={{ fontSize: 14, padding: "6px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={!!c.done} disabled={w.status !== "In Progress"} onChange={(e) => setChecklist(checklist.map((x, i) => (i === n ? { ...x, done: e.target.checked } : x)))} style={{ width: 18, height: 18 }} />{c.item}
          </label>
        ))}
      </div>
      {w.status === "In Progress" && (
        <>
          <label className="field" style={{ marginTop: 10 }}>Note / reading<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Replaced driver, pressure back to 3.1 bar" /></label>
          <label className="btn sm" style={{ marginTop: 8 }}><Icon name="Camera" size={14} /> Add photo<input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhotos([...photos, await photo(f)]); }} /></label>
          <div className="photo-thumbs" style={{ marginTop: 8 }}>{photos.map((p, n) => <img key={n} src={p} alt="evidence" />)}</div>
        </>
      )}
      <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
        {w.status === "Assigned" && <button className="btn primary" onClick={() => act("accept")}>Accept</button>}
        {(w.status === "Assigned" || w.status === "Accepted") && <button className="btn" onClick={() => act("start")}><Icon name="Play" size={14} /> Start</button>}
        {w.status === "In Progress" && <><button className="btn primary" disabled={!allDone} title={allDone ? "" : "Tick every checklist item first"} onClick={() => act("complete")}><Icon name="Check" size={15} /> Complete</button><button className="btn" onClick={() => act("hold")}><Icon name="Pause" size={14} /> Hold</button></>}
        {w.status === "On Hold" && <button className="btn" onClick={() => act("resume")}>Resume</button>}
        {w.status === "Completed" && <span className="hint">Waiting for supervisor verification</span>}
      </div>
      {err && <div className="badge red" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

/** On-site commissioning: confirm the position with GPS and activate a provisioned device. */
function Commission() {
  const { data, reload } = useApi<any[]>("/assets/devices?status=Registered,Provisioned,Faulty,Maintenance", 20_000);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<Record<string, string>>({});
  async function go(d: any, action: string) {
    const done = async (lat?: number, lon?: number) => {
      try {
        if (lat !== undefined) await apiSend("PUT", `/assets/devices/${encodeURIComponent(d.deviceId)}`, { lat, lon, notes: `Position confirmed on site ${new Date().toLocaleString()}` });
        await apiSend("POST", `/assets/devices/${encodeURIComponent(d.deviceId)}/transition`, { action });
        setMsg((m) => ({ ...m, [d.deviceId]: action === "commission" ? "Commissioned" : "Restored" })); await reload();
      } catch (e) { setMsg((m) => ({ ...m, [d.deviceId]: (e as Error).message })); }
    };
    if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => void done(p.coords.latitude, p.coords.longitude), () => void done(), { timeout: 6000 });
    else await done();
  }
  const list = (data ?? []).filter((d) => !q || `${d.deviceId} ${d.serial ?? ""} ${d.siteName ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card">
      <label className="search" style={{ width: "100%", marginBottom: 12 }}><Icon name="Search" size={16} /><input placeholder="Device ID, serial or site" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {list.map((d) => (
        <div key={d.deviceId} className="alert-item">
          <div className="t"><b className="mono">{d.deviceId}</b><span>{d.deviceType} · {[d.zone, d.siteName].filter(Boolean).join(" › ")} · {d.status}</span></div>
          {msg[d.deviceId] ? <span className="badge green">{msg[d.deviceId]}</span>
            : ["Registered", "Provisioned"].includes(d.status) ? <button className="btn sm primary" onClick={() => go(d, "commission")}><Icon name="Crosshair" size={14} /> Confirm here & commission</button>
            : <button className="btn sm" onClick={() => go(d, "restore")}>Restore to active</button>}
        </div>
      ))}
      {!list.length && <div className="empty">No devices waiting for commissioning</div>}
      <p className="hint mt">Commissioning records your GPS position as the device location and makes it Active, so its alarms start opening incidents.</p>
    </div>
  );
}
