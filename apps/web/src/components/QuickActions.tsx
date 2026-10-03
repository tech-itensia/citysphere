import { useState } from "react";
import { apiSend } from "../lib/api";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { DOMAINS } from "../lib/format";
import { Modal, ErrorNote } from "./Ui";
import { Icon } from "./Icon";

const CATS = ["traffic", "water", "electricity", "lighting", "environment", "waste", "parking", "mobility", "emergency", "weather", "events"];
const zonesOf = (me: any, tenant: any) => (tenant?.zones ?? me?.city?.zones ?? []) as Array<{ name: string }>;

/** Operator-raised incident: category, severity, zone or device, optional immediate assignment. */
export function NewIncidentModal({ onClose, onCreated, preset }: { onClose: () => void; onCreated?: (i: any) => void; preset?: { lat?: number; lon?: number; deviceId?: string; zone?: string } }) {
  const { me } = useAuth();
  const { data: tenant } = useApi<any>(me ? `/tenants/${me.tenantId}` : null);
  const [f, setF] = useState({ title: "", category: "traffic", severity: "Medium", zone: preset?.zone ?? "", deviceId: preset?.deviceId ?? "", description: "", assignee: "" });
  const [err, setErr] = useState<string>();
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    try {
      const i = await apiSend("POST", "/incidents", { ...f, zone: f.zone || undefined, deviceId: f.deviceId || undefined, description: f.description || undefined, assignee: f.assignee || undefined, lat: preset?.lat, lon: preset?.lon });
      onCreated?.(i); onClose();
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title="New incident" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={f.title.length < 3} onClick={save}>Create incident</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <label className="field">Title<input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Waterlogging under Minto Bridge" /></label>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <label className="field">Category<select value={f.category} onChange={(e) => set("category", e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{DOMAINS[c]?.label ?? c}</option>)}</select></label>
          <label className="field">Severity<select value={f.severity} onChange={(e) => set("severity", e.target.value)}>{["Critical", "High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="field">Zone<select value={f.zone} onChange={(e) => set("zone", e.target.value)}><option value="">—</option>{zonesOf(me, tenant).map((z) => <option key={z.name}>{z.name}</option>)}</select></label>
          <label className="field">Device (optional)<input value={f.deviceId} onChange={(e) => set("deviceId", e.target.value)} placeholder="e.g. TJ-CONNAU-01" /></label>
        </div>
        <label className="field">Assign now (optional)<select value={f.assignee} onChange={(e) => set("assignee", e.target.value)}><option value="">Leave in queue</option><option>tech.delhi</option><option>waterhead.delhi</option></select></label>
        <label className="field">Description<textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
        {preset?.lat && <div className="hint"><Icon name="MapPin" size={13} /> Location from map: {preset.lat.toFixed(4)}, {preset.lon?.toFixed(4)}</div>}
        <ErrorNote msg={err} />
      </div>
    </Modal>
  );
}

/** Publish an advisory to the citizen portal (and opted-in citizens by email). */
export function AdvisoryModal({ onClose, onDone }: { onClose: () => void; onDone?: () => void }) {
  const { me } = useAuth();
  const { data: tenant } = useApi<any>(me ? `/tenants/${me.tenantId}` : null);
  const [f, setF] = useState({ title: "", body: "", category: "traffic", level: "warning", zone: "", hours: "4" });
  const [err, setErr] = useState<string>();
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    try { await apiSend("POST", "/advisories", { ...f, zone: f.zone || undefined, hours: Number(f.hours) || undefined, body: f.body || undefined }); onDone?.(); onClose(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title="Publish citizen advisory" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={f.title.length < 3} onClick={save}><Icon name="Megaphone" size={15} /> Publish</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <label className="field">Headline<input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Road closed at ITO for repairs" /></label>
        <label className="field">Message<textarea rows={3} value={f.body} onChange={(e) => set("body", e.target.value)} placeholder="What should residents do?" /></label>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <label className="field">Category<select value={f.category} onChange={(e) => set("category", e.target.value)}>{CATS.map((c) => <option key={c} value={c}>{DOMAINS[c]?.label ?? c}</option>)}</select></label>
          <label className="field">Level<select value={f.level} onChange={(e) => set("level", e.target.value)}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
          <label className="field">Zone<select value={f.zone} onChange={(e) => set("zone", e.target.value)}><option value="">Whole city</option>{zonesOf(me, tenant).map((z) => <option key={z.name}>{z.name}</option>)}</select></label>
          <label className="field">Show for (hours)<input type="number" min={1} value={f.hours} onChange={(e) => set("hours", e.target.value)} /></label>
        </div>
        <ErrorNote msg={err} />
      </div>
    </Modal>
  );
}

/** Manual broadcast through configured notification channels (email / SMS / webhook). */
export function BroadcastModal({ onClose }: { onClose: () => void }) {
  const { data: depts } = useApi<any[]>("/departments");
  const [f, setF] = useState({ subject: "", text: "", severity: "High", department: "" });
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string>();
  async function send() {
    try { await apiSend("POST", "/notifications/broadcast", { ...f, department: f.department || undefined }); setDone(true); } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title="Broadcast to teams" onClose={onClose} footer={done ? <button className="btn primary" onClick={onClose}>Done</button> : <><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={f.subject.length < 3} onClick={send}><Icon name="Send" size={15} /> Send</button></>}>
      {done ? <div className="badge green">Sent through every matching channel.</div> : (
        <div className="stack" style={{ gap: 12 }}>
          <label className="field">Subject<input autoFocus value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
          <label className="field">Message<textarea rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <label className="field">Severity<select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{["Critical", "High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">Department<select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">All</option>{(depts ?? []).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}</select></label>
          </div>
          <ErrorNote msg={err} />
        </div>
      )}
    </Modal>
  );
}

/** Shift handover: free-text summary plus open items carried to the next shift. */
export function HandoverModal({ onClose, onDone, openCount }: { onClose: () => void; onDone?: () => void; openCount?: number }) {
  const hour = new Date().getHours();
  const [f, setF] = useState({ shift: hour < 6 || hour >= 22 ? "Night" : hour < 14 ? "Morning" : "Evening", note: "", items: "" });
  const [err, setErr] = useState<string>();
  async function save() {
    try { await apiSend("POST", "/shift-log", { shift: f.shift, note: f.note, openItems: f.items.split("\n").map((s) => s.trim()).filter(Boolean) }); onDone?.(); onClose(); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal title="Shift handover" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={f.note.length < 3} onClick={save}>Sign and hand over</button></>}>
      <div className="stack" style={{ gap: 12 }}>
        <div className="hint">{openCount ?? 0} incidents are still open and stay in the shared queue.</div>
        <label className="field">Shift<select value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })}><option>Morning</option><option>Evening</option><option>Night</option></select></label>
        <label className="field">Summary<textarea rows={4} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="What happened, what is in progress, who was informed" /></label>
        <label className="field">Open items for next shift (one per line)<textarea rows={3} value={f.items} onChange={(e) => setF({ ...f, items: e.target.value })} /></label>
        <ErrorNote msg={err} />
      </div>
    </Modal>
  );
}
