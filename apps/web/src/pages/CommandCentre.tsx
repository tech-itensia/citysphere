import { useMemo, useState } from "react";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { IncidentDrawer } from "../components/IncidentDrawer";
import { DeviceDrawer } from "./Twin";
import { SeverityBadge, StatusBadge } from "../components/Badges";
import { Countdown, Kpi } from "../components/Ui";
import { NewIncidentModal, AdvisoryModal, BroadcastModal, HandoverModal } from "../components/QuickActions";
import { useApi } from "../lib/useApi";
import { useLive, type LiveEvent } from "../lib/live";
import { apiSend } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DOMAINS, SEV_COLOR, SEV_ORDER, fmt, timeAgo, isOpenStatus } from "../lib/format";

const QUEUES = [
  { id: "all", label: "All open" }, { id: "new", label: "Unacknowledged" }, { id: "escalated", label: "Escalated" },
  { id: "citizen", label: "Citizen" }, { id: "correlated", label: "Correlated" }, { id: "mine", label: "Pending confirm" },
];
const LAYERS = ["traffic", "water", "electricity", "lighting", "environment", "waste", "parking", "fleet"];
const FLEET = ["mobility", "emergency"];

/**
 * Command Centre (SOW 4.2, D4.1-D4.4): one screen to run a shift. KPI strip, triage queue, live map with layers and
 * 24 h replay, SLA watchlist with countdowns, correlation insights, live feed, quick actions, advisories and shift handover.
 */
export function CommandCentre() {
  const { me } = useAuth();
  const { data: overview } = useApi<any>("/overview", 30_000);
  const { data: devices, setData: setDevices } = useApi<any[]>("/twin/devices", 30_000);
  const { data: incidents, reload } = useApi<any[]>("/incidents?open=true&limit=300", 15_000);
  const since = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const { data: history } = useApi<any[]>(`/incidents?since=${encodeURIComponent(since)}&limit=500&sort=recent`, 60_000);
  const { data: atRisk } = useApi<any[]>("/sla/at-risk?limit=25", 10_000);
  const { data: advisories, reload: reloadAdv } = useApi<any[]>("/advisories", 60_000);
  const { data: shiftLog, reload: reloadShift } = useApi<any[]>("/shift-log", 60_000);
  const [queue, setQueue] = useState("all");
  const [sev, setSev] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [layers, setLayers] = useState<string[]>(LAYERS);
  const [showIncidents, setShowIncidents] = useState(true);
  const [replay, setReplay] = useState(100);
  const [open, setOpen] = useState<string>();
  const [device, setDevice] = useState<string>();
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [busy, setBusy] = useState<string>();
  const [modal, setModal] = useState<"incident" | "advisory" | "broadcast" | "handover" | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number }>();
  const [wall, setWall] = useState(false);

  useLive((e) => {
    if (e.event !== "twin") setFeed((f) => [e, ...f].slice(0, 60));
    else if (Math.random() < 0.25) setFeed((f) => [e, ...f].slice(0, 60));
    if (e.event === "incident" || e.event === "alert" || e.event === "sla") void reload();
    if (e.event === "twin") {
      const d = e.data?.data;
      if (d?.deviceId) setDevices((list) => (list ?? []).map((x) => (x.deviceId === d.deviceId ? { ...x, values: { ...x.values, ...d.values }, ts: Date.now(), ...(d.location ? { lat: d.location.lat, lon: d.location.lon } : {}) } : x)));
    }
  });

  const byId = useMemo(() => new Map([...(history ?? []), ...(incidents ?? [])].map((i) => [i.id, i])), [incidents, history]);
  const list = incidents ?? [];
  const count = (s: string) => list.filter((i) => i.severity === s).length;
  const queueFilter = (i: any) => queue === "all" ? true : queue === "new" ? i.status === "New" : queue === "escalated" ? (i.status === "Escalated" || i.escalationLevel > 0)
    : queue === "citizen" ? i.source === "citizen" : queue === "correlated" ? i.source === "correlation" : i.status === "Resolution Pending";
  const shown = list.filter((i) => queueFilter(i) && (!sev.length || sev.includes(i.severity)) && (!search || `${i.ref} ${i.title} ${i.zone ?? ""} ${i.deviceId ?? ""}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || (a.createdAt < b.createdAt ? 1 : -1));

  // replay: incidents as they stood at time T (last 24 h)
  const replayAt = Date.now() - (100 - replay) * 0.01 * 24 * 3600_000;
  const mapIncidents = !showIncidents ? [] : replay === 100 ? shown : [...byId.values()].filter((i) => {
    const c = new Date(i.createdAt).getTime();
    const end = i.closedAt ? new Date(i.closedAt).getTime() : i.resolvedAt ? new Date(i.resolvedAt).getTime() : Infinity;
    return c <= replayAt && end > replayAt;
  });
  const mapDevices = (devices ?? []).filter((d) => layers.includes(FLEET.includes(d.domain) ? "fleet" : d.domain) || d.domain === "weather");
  const offline = (devices ?? []).filter((d) => d.online === false).length;
  const breached = (atRisk ?? []).filter((t) => t.rag === "red").length;
  const atRiskSoon = (atRisk ?? []).filter((t) => t.rag !== "red" && t.remainingMs < 30 * 60_000).length;
  const correlated = list.filter((i) => i.source === "correlation");
  const center = me?.city?.center ?? overview?.tenant?.center ?? { lat: 28.6139, lon: 77.209 };
  const weather = overview?.weather;

  async function ack(id: string) {
    setBusy(id);
    try { await apiSend("POST", `/incidents/${id}/transition`, { action: "acknowledge" }); await reload(); } finally { setBusy(undefined); }
  }

  const body = (
    <>
      <div className="grid cols-6k">
        <Kpi label="Open incidents" icon="AlertTriangle" value={fmt(list.length)} sub={<span><b style={{ color: SEV_COLOR.Critical }}>{count("Critical")}</b> critical · <b style={{ color: SEV_COLOR.High }}>{count("High")}</b> high</span>} />
        <Kpi label="Unacknowledged" icon="Bell" value={list.filter((i) => i.status === "New").length} tone={list.some((i) => i.status === "New" && i.severity === "Critical") ? "#dc2626" : undefined} sub="response clock running" />
        <Kpi label="SLA breached / at risk" icon="Clock" value={<>{breached}<span style={{ fontSize: 18, color: "#ea580c" }}> / {atRiskSoon}</span></>} tone={breached ? "#dc2626" : undefined} sub="at risk = due in 30 min" />
        <Kpi label="Escalated" icon="Flag" value={list.filter((i) => i.status === "Escalated" || i.escalationLevel > 0).length} sub="needs supervisor" />
        <Kpi label="Assets offline" icon="WifiOff" value={offline} sub={`of ${fmt(devices?.length)} reporting`} tone={offline ? "#ea580c" : undefined} />
        <Kpi label="Weather · advisories" icon="CloudRain" value={weather ? `${Math.round(weather.temperatureC ?? 0)}°C` : "–"} sub={`${weather?.rainMm ?? 0} mm rain · ${(advisories ?? []).length} live advisories`} />
      </div>

      <div className="cc-grid mt">
        {/* ---------------- queue */}
        <div className="card" style={{ display: "flex", flexDirection: "column", maxHeight: wall ? "calc(100vh - 230px)" : 760 }}>
          <h3>Incident queue <span className="hint" style={{ marginLeft: "auto" }}>{shown.length}</span></h3>
          <div className="chips" style={{ marginBottom: 8 }}>
            {QUEUES.map((q) => <button key={q.id} className={`chip${queue === q.id ? " on" : ""}`} onClick={() => setQueue(q.id)}>{q.label}</button>)}
          </div>
          <div className="chips" style={{ marginBottom: 8 }}>
            {SEV_ORDER.map((s) => (
              <button key={s} className={`chip${sev.includes(s) ? " on" : ""}`} style={sev.includes(s) ? { background: SEV_COLOR[s], borderColor: SEV_COLOR[s] } : undefined}
                onClick={() => setSev((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s} {count(s)}</button>
            ))}
          </div>
          <label className="search" style={{ marginBottom: 8, width: "100%" }}><Icon name="Search" size={16} /><input placeholder="Ref, title, zone, device" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <div className="scroll" style={{ flex: 1 }}>
            {shown.map((i) => (
              <div key={i.id} className="alert-item" onClick={() => setOpen(i.id)} style={{ alignItems: "flex-start" }}>
                <span className="sevdot" style={{ background: SEV_COLOR[i.severity], marginTop: 6 }} />
                <div className="t">
                  <b>{i.title}</b>
                  <span>{i.ref} · {i.zone ?? "–"} · {timeAgo(i.createdAt)}</span>
                  <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
                    <SeverityBadge s={i.severity} /><StatusBadge s={i.status} />
                    {i.source !== "alarm" && <span className="badge grey" style={{ textTransform: "capitalize" }}>{i.source}</span>}
                    {i.escalationLevel > 0 && <span className="badge red">L{i.escalationLevel}</span>}
                  </div>
                </div>
                {i.status === "New" && <button className="btn sm primary" disabled={busy === i.id} onClick={(e) => { e.stopPropagation(); void ack(i.id); }}>Ack</button>}
              </div>
            ))}
            {!shown.length && <div className="empty">Nothing in this queue</div>}
          </div>
        </div>

        {/* ---------------- map */}
        <div className="card cc-map">
          <div className="chips" style={{ marginBottom: 10 }}>
            <button className={`chip${showIncidents ? " on" : ""}`} onClick={() => setShowIncidents((x) => !x)}><Icon name="AlertTriangle" size={13} /> Incidents</button>
            {LAYERS.map((l) => (
              <button key={l} className={`chip${layers.includes(l) ? " on" : ""}`} onClick={() => setLayers((x) => (x.includes(l) ? x.filter((y) => y !== l) : [...x, l]))}>
                {l === "fleet" ? "Fleet & drones" : DOMAINS[l]?.label ?? l}
              </button>
            ))}
          </div>
          <CityMap title={replay === 100 ? "Live city map" : `Replay · ${new Date(replayAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} live={replay === 100}
            tall center={center} devices={mapDevices} incidents={mapIncidents} onSelectIncident={setOpen} onSelectDevice={setDevice}
            onPick={(lat, lon) => setPicked({ lat, lon })} showLegend={false} height={wall ? 560 : 520} />
          <div className="row mt" style={{ gap: 12 }}>
            <Icon name="History" size={16} color="#64748b" />
            <input className="slider" type="range" min={0} max={100} value={replay} onChange={(e) => setReplay(Number(e.target.value))} aria-label="Replay last 24 hours" />
            <span className="hint" style={{ whiteSpace: "nowrap" }}>{replay === 100 ? "Live" : `-${Math.round((100 - replay) * 0.24)} h`}</span>
            {replay !== 100 && <button className="btn sm" onClick={() => setReplay(100)}>Back to live</button>}
          </div>
          {picked && (
            <div className="banner" style={{ marginTop: 10, marginBottom: 0 }}>
              <Icon name="MapPin" size={15} /> {picked.lat.toFixed(4)}, {picked.lon.toFixed(4)}
              <button className="btn sm primary" style={{ marginLeft: "auto" }} onClick={() => setModal("incident")}>Raise incident here</button>
              <button className="btn sm" onClick={() => setPicked(undefined)}>Clear</button>
            </div>
          )}
        </div>

        {/* ---------------- right rail */}
        <div className="stack">
          <div className="card">
            <h3><Icon name="Clock" size={16} /> SLA watchlist <span className="hint" style={{ marginLeft: "auto" }}>time to breach</span></h3>
            <div className="scroll" style={{ maxHeight: 260 }}>
              {(atRisk ?? []).slice(0, 12).map((t) => {
                const i = byId.get(t.incidentId);
                return (
                  <div key={`${t.incidentId}-${t.clock}`} className="alert-item" onClick={() => setOpen(t.incidentId)}>
                    <span className="sevdot" style={{ background: SEV_COLOR[t.severity] }} />
                    <div className="t"><b>{i?.title ?? t.incidentId.slice(0, 8)}</b><span style={{ textTransform: "capitalize" }}>{t.clock} · {i?.ref ?? ""}{t.escalateTo ? ` · → ${t.escalateTo}` : ""}</span></div>
                    <Countdown to={t.dueAt} />
                  </div>
                );
              })}
              {!atRisk?.length && <div className="empty">No running clocks</div>}
            </div>
          </div>
          <div className="card">
            <h3><Icon name="Sparkles" size={16} /> Correlation insights</h3>
            {correlated.slice(0, 4).map((i) => (
              <div key={i.id} className="alert-item" onClick={() => setOpen(i.id)}>
                <div className="t"><b>{i.title}</b><span>{(i.description ?? "").replace("Correlated: ", "")}</span></div><SeverityBadge s={i.severity} />
              </div>
            ))}
            {!correlated.length && <div className="empty">No cross-domain patterns right now</div>}
          </div>
          <div className="card">
            <h3><Icon name="Radio" size={16} /> Live feed</h3>
            <div className="ticker" style={{ maxHeight: 220, overflow: "auto" }}>
              {feed.map((e, n) => (
                <div key={n}>
                  <time>{new Date(e.at).toLocaleTimeString()}</time>
                  <span><b style={{ textTransform: "capitalize" }}>{e.event}</b> {e.data?.entity?.name ?? e.data?.entity?.id} {e.data?.type ? `· ${e.data.type}` : ""}</span>
                </div>
              ))}
              {!feed.length && <div className="empty">Waiting for events…</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2 mt">
        <div className="card">
          <h3><Icon name="Megaphone" size={16} /> Citizen advisories <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setModal("advisory")}><Icon name="Plus" size={14} /> Publish</button></h3>
          {(advisories ?? []).map((a) => (
            <div key={a.id} className="alert-item">
              <span className={`badge ${a.level === "critical" ? "red" : a.level === "warning" ? "amber" : "blue"}`}>{a.level}</span>
              <div className="t"><b>{a.title}</b><span>{a.zone ?? "Whole city"} · {a.endsAt ? `until ${new Date(a.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "open-ended"}</span></div>
              <button className="btn sm" onClick={async () => { await apiSend("POST", `/advisories/${a.id}/end`); await reloadAdv(); }}>End</button>
            </div>
          ))}
          {!advisories?.length && <div className="empty">No live advisories</div>}
        </div>
        <div className="card">
          <h3><Icon name="ListChecks" size={16} /> Shift handover <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setModal("handover")}>Hand over shift</button></h3>
          {(shiftLog ?? []).slice(0, 3).map((s) => (
            <div key={s.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <div className="row between"><b>{s.shift} shift · {s.author}</b><span className="hint">{timeAgo(s.at)}</span></div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", margin: "4px 0" }}>{s.note}</div>
              {(s.openItems ?? []).map((o: string, n: number) => <div key={n} className="hint row" style={{ gap: 6 }}><Icon name="ChevronRight" size={12} />{o}</div>)}
            </div>
          ))}
          {!shiftLog?.length && <div className="empty">No handovers yet</div>}
        </div>
      </div>
    </>
  );

  const actions = (
    <>
      <button className="btn primary" onClick={() => setModal("incident")}><Icon name="Plus" size={16} /> New incident</button>
      <button className="btn" onClick={() => setModal("advisory")}><Icon name="Megaphone" size={16} /> Advisory</button>
      <button className="btn" onClick={() => setModal("broadcast")}><Icon name="Send" size={16} /> Broadcast</button>
      <button className="btn" onClick={() => setWall((w) => !w)}><Icon name={wall ? "Minimize2" : "Monitor"} size={16} /> {wall ? "Exit wall" : "Wall mode"}</button>
    </>
  );

  return (
    <>
      {wall ? (
        <div className="wall">
          <div className="row between" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>Command Centre · {me?.city?.cityName ?? overview?.tenant?.cityName ?? ""} <span className="live" style={{ marginLeft: 10 }}><i /> Live</span></h2>
            <div className="row">{actions}</div>
          </div>
          {body}
        </div>
      ) : (
        <Page title="Command Centre" subtitle="Run the shift: triage, dispatch, watch the clocks, keep citizens informed." actions={actions}>{body}</Page>
      )}
      {open && <IncidentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={reload} />}
      {device && <DeviceDrawer id={device} onClose={() => setDevice(undefined)} />}
      {modal === "incident" && <NewIncidentModal preset={picked} onClose={() => setModal(null)} onCreated={() => { setPicked(undefined); void reload(); }} />}
      {modal === "advisory" && <AdvisoryModal onClose={() => setModal(null)} onDone={reloadAdv} />}
      {modal === "broadcast" && <BroadcastModal onClose={() => setModal(null)} />}
      {modal === "handover" && <HandoverModal openCount={list.filter((i) => isOpenStatus(i.status)).length} onClose={() => setModal(null)} onDone={reloadShift} />}
    </>
  );
}
