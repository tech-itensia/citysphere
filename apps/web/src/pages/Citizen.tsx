import { useState } from "react";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { StatusBadge } from "../components/Badges";
import { Icon } from "../components/Icon";
import { useApi } from "../lib/useApi";
import { apiSend } from "../lib/api";
import { DOMAINS, timeAgo } from "../lib/format";

const CATEGORIES = ["water", "lighting", "waste", "traffic", "electricity", "environment", "parking"];

/** Citizen portal: report an issue (pin it on the map) and track my reports. */
export function Citizen() {
  const { data: mine, reload } = useApi<any[]>("/incidents?limit=50", 30_000);
  const [form, setForm] = useState({ category: "water", title: "", description: "" });
  const [pin, setPin] = useState<{ lat: number; lon: number }>();
  const [done, setDone] = useState<string>();

  async function submit() {
    const inc = await apiSend<any>("POST", "/incidents", { ...form, description: form.description || undefined, ...(pin ? { lat: pin.lat, lon: pin.lon } : {}) });
    setDone(inc?.ref ?? "submitted"); setForm({ category: "water", title: "", description: "" }); setPin(undefined); await reload();
  }

  return (
    <Page title="Report an issue" subtitle="Tell the city about a problem. You can track it here until it is fixed.">
      <div className="grid main-side">
        <div className="card">
          <h3><Icon name="MapPin" size={17} /> Where is it? <span className="hint" style={{ marginLeft: "auto" }}>{pin ? `${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}` : "Click the map"}</span></h3>
          <CityMap center={{ lat: 28.6139, lon: 77.209 }} incidents={pin ? [{ id: "pin", title: "Your report", severity: "Low", lat: pin.lat, lon: pin.lon }] : []}
            onPick={(lat, lon) => setPin({ lat, lon })} height={380} showLegend={false} live={false} />
        </div>
        <div className="stack">
          <div className="card">
            <h3>What happened?</h3>
            <div className="chips" style={{ marginBottom: 12 }}>
              {CATEGORIES.map((c) => <button key={c} className={`chip${form.category === c ? " on" : ""}`} onClick={() => setForm({ ...form, category: c })}>{DOMAINS[c].label}</button>)}
            </div>
            <label className="field">Short title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Street light not working" /></label>
            <label className="field" style={{ marginTop: 10 }}>Details<textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <button className="btn primary mt" disabled={form.title.length < 3} onClick={submit}><Icon name="Send" size={15} /> Submit report</button>
            {done && <div className="badge green" style={{ marginTop: 10 }}>Thank you! Reference {done}</div>}
          </div>
          <div className="card">
            <h3>My reports</h3>
            {(mine ?? []).map((i) => (
              <div key={i.id} className="alert-item"><div className="t"><b>{i.title}</b><span>{i.ref} · {timeAgo(i.createdAt)}</span></div><StatusBadge s={i.status} /></div>
            ))}
            {!mine?.length && <div className="empty">No reports yet</div>}
          </div>
        </div>
      </div>
    </Page>
  );
}
