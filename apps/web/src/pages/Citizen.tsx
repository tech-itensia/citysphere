import { useMemo, useState } from "react";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { IncidentDrawer } from "../components/IncidentDrawer";
import { Tabs, useTab, Stepper, ErrorNote } from "../components/Ui";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { apiSend } from "../lib/api";
import { DOMAINS, timeAgo } from "../lib/format";

const CATEGORIES: Array<[string, string]> = [
  ["lighting", "Street light"], ["water", "Water / leak"], ["waste", "Garbage"], ["traffic", "Traffic signal / road"], ["electricity", "Power cut"],
  ["environment", "Pollution / noise"], ["parking", "Parking"], ["events", "Other"],
];
const CITIZEN_STEPS = ["Received", "Being fixed", "Fixed, please confirm", "Closed"];
const stepOf = (s: string) => (s === "New" || s === "Acknowledged" ? 0 : ["Assigned", "In Progress", "Escalated"].includes(s) ? 1 : s === "Resolution Pending" ? 2 : 3);

/** Citizen portal (D2.7 + beyond): report with photo and pin, track and confirm my requests, advisories, journey check, preferences. */
export function Citizen() {
  const { me } = useAuth();
  const [tab, setTab] = useTab("home", ["home", "report", "mine", "advisories", "journey", "preferences"]);
  const { data: mine, reload } = useApi<any[]>("/incidents?mine=true&limit=50&sort=recent", 30_000);
  const { data: advisories } = useApi<any[]>("/advisories", 60_000);
  const { data: tenant } = useApi<any>(me ? `/tenants/${me.tenantId}` : null);
  const [open, setOpen] = useState<string>();
  const pending = (mine ?? []).filter((i) => i.status === "Resolution Pending");
  return (
    <Page title={`Hello${me?.displayName ? `, ${me.displayName.split(" ")[0]}` : ""}`} subtitle={`${tenant?.cityName ?? "Your city"} citizen services: report a problem, follow it until it is fixed, and stay informed.`}
      actions={<button className="btn primary" onClick={() => setTab("report")}><Icon name="Plus" size={16} /> Report an issue</button>}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "home", label: "Home", icon: "Home" }, { id: "report", label: "Report", icon: "Camera" }, { id: "mine", label: "My requests", icon: "ClipboardList", count: (mine ?? []).length },
        { id: "advisories", label: "Advisories", icon: "Megaphone", count: (advisories ?? []).length }, { id: "journey", label: "Journey check", icon: "Route" }, { id: "preferences", label: "Alerts & preferences", icon: "Bell" },
      ]} />
      {tab === "home" && (
        <div className="grid main-side">
          <div className="stack">
            {pending.length > 0 && <div className="banner warning"><Icon name="Check" size={16} /> {pending.length} of your reports {pending.length === 1 ? "has" : "have"} been fixed. Please confirm or reopen. <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setTab("mine")}>Review</button></div>}
            <div className="card">
              <h3>What would you like to report?</h3>
              <div className="choice-grid">
                {CATEGORIES.map(([c, label]) => { const m = DOMAINS[c] ?? DOMAINS.generic; return <div key={c} className="choice" onClick={() => setTab(`report`)}><Icon name={m.icon} size={22} color={m.color} /><div><b>{label}</b></div></div>; })}
              </div>
            </div>
            <div className="card">
              <h3>City advisories</h3>
              {(advisories ?? []).slice(0, 3).map((a) => <Advisory key={a.id} a={a} />)}
              {!advisories?.length && <div className="empty">No advisories right now</div>}
            </div>
          </div>
          <div className="card">
            <h3>My recent requests</h3>
            {(mine ?? []).slice(0, 5).map((i) => <RequestRow key={i.id} i={i} onOpen={setOpen} />)}
            {!mine?.length && <div className="empty">You have not reported anything yet</div>}
          </div>
        </div>
      )}
      {tab === "report" && <ReportWizard tenant={tenant} onDone={() => { void reload(); setTab("mine"); }} />}
      {tab === "mine" && (
        <div className="card">
          {(mine ?? []).map((i) => <RequestRow key={i.id} i={i} onOpen={setOpen} big />)}
          {!mine?.length && <div className="empty">No requests yet</div>}
        </div>
      )}
      {tab === "advisories" && (
        <div className="grid main-side">
          <div className="card"><CityMap center={tenant?.center ?? { lat: 28.6139, lon: 77.209 }} height={440} showLegend={false} live={false}
            incidents={(advisories ?? []).filter((a) => a.lat).map((a) => ({ id: a.id, title: a.title, severity: a.level === "critical" ? "Critical" : a.level === "warning" ? "Medium" : "Low", lat: a.lat, lon: a.lon }))} /></div>
          <div className="card">{(advisories ?? []).map((a) => <Advisory key={a.id} a={a} />)}{!advisories?.length && <div className="empty">No advisories right now</div>}</div>
        </div>
      )}
      {tab === "journey" && <Journey tenant={tenant} advisories={advisories ?? []} />}
      {tab === "preferences" && <Preferences tenant={tenant} />}
      {open && <IncidentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={reload} />}
    </Page>
  );
}

function Advisory({ a }: { a: any }) {
  return (
    <div className="alert-item">
      <span className={`badge ${a.level === "critical" ? "red" : a.level === "warning" ? "amber" : "blue"}`}>{a.level}</span>
      <div className="t"><b>{a.title}</b><span>{a.body}</span><span>{a.zone ?? "Whole city"} · {timeAgo(a.startsAt)}{a.endsAt ? ` · until ${new Date(a.endsAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}` : ""}</span></div>
    </div>
  );
}

function RequestRow({ i, onOpen, big }: { i: any; onOpen: (id: string) => void; big?: boolean }) {
  const st = stepOf(i.status);
  return (
    <div className="alert-item" onClick={() => onOpen(i.id)} style={{ alignItems: "flex-start" }}>
      <span className="ic" style={{ background: `${(DOMAINS[i.category] ?? DOMAINS.generic).color}1a` }}><Icon name={(DOMAINS[i.category] ?? DOMAINS.generic).icon} size={18} color={(DOMAINS[i.category] ?? DOMAINS.generic).color} /></span>
      <div className="t" style={{ flex: 1 }}>
        <b>{i.title}</b><span>{i.ref} · {timeAgo(i.createdAt)}{i.zone ? ` · ${i.zone}` : ""}</span>
        {big && <div style={{ marginTop: 8 }}><Stepper steps={CITIZEN_STEPS} current={i.status === "Closed" ? 4 : st} /></div>}
      </div>
      <span className={`badge ${st === 2 ? "amber" : st === 3 ? "green" : "blue"}`}>{CITIZEN_STEPS[st]}</span>
    </div>
  );
}

/** Downscale a photo in the browser so uploads stay small (max 1024 px, JPEG). */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const k = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return c.toDataURL("image/jpeg", 0.72);
}

function ReportWizard({ tenant, onDone }: { tenant?: any; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<any>({ category: "", title: "", description: "", lat: undefined, lon: undefined, photos: [] as any[] });
  const [ref, setRef] = useState<string>();
  const [err, setErr] = useState<string>();
  const [locating, setLocating] = useState(false);
  function locate() {
    if (!navigator.geolocation) return setErr("Location is not available on this device");
    setLocating(true);
    navigator.geolocation.getCurrentPosition((p) => { setF((x: any) => ({ ...x, lat: p.coords.latitude, lon: p.coords.longitude })); setLocating(false); }, () => { setErr("Could not get your location; tap the map instead"); setLocating(false); }, { timeout: 8000 });
  }
  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const out: any[] = [];
    for (const file of Array.from(files).slice(0, 3 - f.photos.length)) out.push({ name: file.name, dataUrl: await shrink(file) });
    setF((x: any) => ({ ...x, photos: [...x.photos, ...out] }));
  }
  async function submit() {
    setErr(undefined);
    try {
      const i = await apiSend<any>("POST", "/incidents", { category: f.category, title: f.title, description: f.description || undefined, lat: f.lat, lon: f.lon, photos: f.photos.length ? f.photos : undefined });
      setRef(i?.ref ?? "submitted"); setStep(3);
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="card">
      <Stepper steps={["What", "Where", "Details & photo", "Done"]} current={step} />
      {step === 0 && (
        <div className="choice-grid">
          {CATEGORIES.map(([c, label]) => { const m = DOMAINS[c] ?? DOMAINS.generic; return (
            <div key={c} className={`choice${f.category === c ? " on" : ""}`} onClick={() => { setF({ ...f, category: c, title: f.title || label + " problem" }); setStep(1); }}><Icon name={m.icon} size={22} color={m.color} /><b>{label}</b></div>
          ); })}
        </div>
      )}
      {step === 1 && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn" onClick={locate} disabled={locating}><Icon name="Crosshair" size={15} /> {locating ? "Locating…" : "Use my location"}</button>
            <span className="hint">or tap the map where the problem is</span>
            {f.lat && <span className="badge green" style={{ marginLeft: "auto" }}>{f.lat.toFixed(4)}, {f.lon.toFixed(4)}</span>}
          </div>
          <CityMap center={f.lat ? { lat: f.lat, lon: f.lon } : tenant?.center ?? { lat: 28.6139, lon: 77.209 }} height={380} showLegend={false} live={false}
            incidents={f.lat ? [{ id: "pin", title: "Your report", severity: "Low", lat: f.lat, lon: f.lon }] : []} onPick={(lat, lon) => setF({ ...f, lat, lon })} />
        </>
      )}
      {step === 2 && (
        <div className="grid cols-2" style={{ gap: 14 }}>
          <div className="stack" style={{ gap: 12 }}>
            <label className="field">Short title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label className="field">What did you see?<textarea rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Lamp off for 3 nights outside house 14" /></label>
          </div>
          <div>
            <label className="btn"><Icon name="Camera" size={15} /> Add photo<input type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhotos(e.target.files)} /></label>
            <span className="hint" style={{ marginLeft: 8 }}>up to 3</span>
            <div className="photo-thumbs mt">{f.photos.map((p: any, n: number) => <img key={n} src={p.dataUrl} alt={p.name} />)}</div>
            <p className="hint mt">Your name and contact details are never shown to other residents. Only you and the city team can see this request.</p>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="stack" style={{ alignItems: "flex-start" }}>
          <div className="badge green" style={{ fontSize: 14, padding: "8px 12px" }}>Thank you! Reference {ref}</div>
          <p>The {DOMAINS[f.category]?.label ?? "city"} team will look at it. You will see each step in My requests, and we will ask you to confirm when it is fixed.</p>
          <button className="btn primary" onClick={onDone}>Track my request</button>
        </div>
      )}
      <ErrorNote msg={err} />
      {step > 0 && step < 3 && (
        <div className="row mt" style={{ justifyContent: "space-between" }}>
          <button className="btn" onClick={() => setStep(step - 1)}>Back</button>
          {step === 1 ? <button className="btn primary" disabled={!f.lat} onClick={() => setStep(2)}>Next</button> : <button className="btn primary" disabled={f.title.length < 3} onClick={submit}><Icon name="Send" size={15} /> Submit report</button>}
        </div>
      )}
    </div>
  );
}

function Journey({ tenant, advisories }: { tenant?: any; advisories: any[] }) {
  const zones: any[] = tenant?.zones ?? [];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const a = zones.find((z) => z.name === from), b = zones.find((z) => z.name === to);
  const onRoute = useMemo(() => {
    if (!a || !b) return [];
    // zones whose centre lies within ~3 km of the straight line between the two zones
    const near = (p: any) => {
      const dx = b.lon - a.lon, dy = b.lat - a.lat, t = Math.max(0, Math.min(1, ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / (dx * dx + dy * dy || 1)));
      const x = a.lon + t * dx, y = a.lat + t * dy;
      return Math.hypot((p.lon - x) * 101, (p.lat - y) * 111) < 3;
    };
    const names = new Set(zones.filter(near).map((z) => z.name));
    return advisories.filter((v) => !v.zone || names.has(v.zone) || (v.lat && near(v)));
  }, [a, b, zones, advisories]);
  return (
    <div className="grid main-side">
      <div className="card">
        <div className="filters">
          <label className="field">From<select value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{zones.map((z) => <option key={z.name}>{z.name}</option>)}</select></label>
          <label className="field">To<select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{zones.map((z) => <option key={z.name}>{z.name}</option>)}</select></label>
        </div>
        <CityMap center={tenant?.center ?? { lat: 28.6139, lon: 77.209 }} height={400} showLegend={false} live={false}
          incidents={[...(a ? [{ id: "a", title: `From ${a.name}`, severity: "Low", lat: a.lat, lon: a.lon }] : []), ...(b ? [{ id: "b", title: `To ${b.name}`, severity: "Low", lat: b.lat, lon: b.lon }] : []),
            ...onRoute.filter((v) => v.lat).map((v) => ({ id: v.id, title: v.title, severity: v.level === "critical" ? "Critical" : "Medium", lat: v.lat, lon: v.lon }))]} />
      </div>
      <div className="card">
        <h3><Icon name="Route" size={16} /> Before you go</h3>
        {!a || !b ? <div className="hint">Pick where you are going to see advisories along the way.</div> : onRoute.length ? onRoute.map((v) => <Advisory key={v.id} a={v} />) : <div className="badge green">No advisories on this route right now.</div>}
      </div>
    </div>
  );
}

function Preferences({ tenant }: { tenant?: any }) {
  const { data, reload } = useApi<any>("/notifications/preferences");
  const [f, setF] = useState<any>();
  const [saved, setSaved] = useState(false);
  const p = f ?? data ?? { channels: ["email"], zones: [], categories: [], advisories: true };
  const toggle = (k: string, v: string) => setF({ ...p, [k]: (p[k] ?? []).includes(v) ? p[k].filter((x: string) => x !== v) : [...(p[k] ?? []), v] });
  async function save() { await apiSend("PUT", "/notifications/preferences", { ...p, email: p.email || undefined, phone: p.phone || undefined }); setSaved(true); setF(undefined); await reload(); }
  return (
    <div className="card" style={{ maxWidth: 760 }}>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <label className="field">Email<input value={p.email ?? ""} onChange={(e) => setF({ ...p, email: e.target.value })} /></label>
        <label className="field">Mobile (SMS)<input value={p.phone ?? ""} onChange={(e) => setF({ ...p, phone: e.target.value })} /></label>
      </div>
      <div className="hint mt">Send me updates by</div>
      <div className="chips mt">{["email", "sms", "push"].map((c) => <button key={c} className={`chip${p.channels?.includes(c) ? " on" : ""}`} onClick={() => toggle("channels", c)}>{c.toUpperCase()}</button>)}</div>
      <label className="row mt" style={{ fontSize: 13 }}><input type="checkbox" checked={!!p.advisories} onChange={(e) => setF({ ...p, advisories: e.target.checked })} /> Tell me about new city advisories</label>
      <div className="hint mt">Only for these areas (none = whole city)</div>
      <div className="chips mt">{(tenant?.zones ?? []).map((z: any) => <button key={z.name} className={`chip${p.zones?.includes(z.name) ? " on" : ""}`} onClick={() => toggle("zones", z.name)}>{z.name}</button>)}</div>
      <button className="btn primary mt" onClick={save}>Save preferences</button>
      {saved && <span className="badge green" style={{ marginLeft: 8 }}>Saved</span>}
      <p className="hint mt">You always get updates about your own reports on the channels you choose.</p>
    </div>
  );
}
