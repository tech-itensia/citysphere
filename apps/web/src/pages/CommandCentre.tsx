import { useMemo, useState } from "react";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { IncidentDrawer } from "../components/IncidentDrawer";
import { DeviceDrawer } from "./Twin";
import { SeverityBadge, SlaBadge, StatusBadge } from "../components/Badges";
import { useApi } from "../lib/useApi";
import { useLive, type LiveEvent } from "../lib/live";
import { apiSend } from "../lib/api";
import { DOMAINS, SEV_COLOR, SEV_ORDER, fmt, timeAgo } from "../lib/format";

/** Command Centre Operator: live map + incident queue + SLA timers + live event feed (SOW 4.2). */
export function CommandCentre() {
  const { data: overview } = useApi<any>("/overview", 30_000);
  const { data: devices, setData: setDevices } = useApi<any[]>("/twin/devices", 30_000);
  const { data: incidents, reload } = useApi<any[]>("/incidents?open=true&limit=200", 15_000);
  const ids = (incidents ?? []).slice(0, 60).map((i) => i.id).join(",");
  const { data: timers } = useApi<any[]>(ids ? `/sla/timers?incidentIds=${ids}` : null, 15_000);
  const [sev, setSev] = useState<string[]>([]);
  const [domain, setDomain] = useState<string>("");
  const [open, setOpen] = useState<string>();
  const [device, setDevice] = useState<string>();
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [busy, setBusy] = useState<string>();

  useLive((e) => {
    setFeed((f) => [e, ...f].slice(0, 40));
    if (e.event === "incident" || e.event === "alert" || e.event === "sla") void reload();
    if (e.event === "twin") {
      const d = e.data?.data;
      if (d?.deviceId) setDevices((list) => (list ?? []).map((x) => (x.deviceId === d.deviceId ? { ...x, values: { ...x.values, ...d.values }, ts: Date.now() } : x)));
    }
  });

  const timerOf = useMemo(() => new Map((timers ?? []).map((t) => [t.incidentId, t])), [timers]);
  const queue = useMemo(() => (incidents ?? [])
    .filter((i) => (!sev.length || sev.includes(i.severity)) && (!domain || i.category === domain))
    .sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity) || (a.createdAt < b.createdAt ? 1 : -1)), [incidents, sev, domain]);
  const mapDevices = useMemo(() => (devices ?? []).filter((d) => !domain || d.domain === domain), [devices, domain]);

  const count = (s: string) => (incidents ?? []).filter((i) => i.severity === s).length;
  const breached = (timers ?? []).filter((t) => t.response === "red" || t.resolution === "red").length;
  const center = overview?.tenant?.center ?? { lat: 28.6139, lon: 77.209 };

  async function ack(id: string) {
    setBusy(id);
    try { await apiSend("POST", `/incidents/${id}/transition`, { action: "acknowledge" }); await reload(); } finally { setBusy(undefined); }
  }

  return (
    <Page title="Command Centre" subtitle="Live operations: incidents, assets and SLA timers across the city.">
      <div className="grid cols-4">
        <div className="card"><div className="hint">Open incidents</div><b style={{ fontSize: 28 }}>{fmt(incidents?.length)}</b></div>
        <div className="card"><div className="hint">Critical / High</div><b style={{ fontSize: 28, color: "#dc2626" }}>{count("Critical")}</b><b style={{ fontSize: 20, color: "#ea580c" }}> / {count("High")}</b></div>
        <div className="card"><div className="hint">SLA breached</div><b style={{ fontSize: 28, color: breached ? "#dc2626" : "inherit" }}>{breached}</b></div>
        <div className="card"><div className="hint">Assets reporting</div><b style={{ fontSize: 28 }}>{fmt((devices ?? []).filter((d) => d.online !== false).length)}</b><span className="hint"> / {fmt(devices?.length)}</span></div>
      </div>

      <div className="grid main-side mt">
        <div className="card">
          <div className="chips" style={{ marginBottom: 12 }}>
            <button className={`chip${!domain ? " on" : ""}`} onClick={() => setDomain("")}>All systems</button>
            {["traffic", "water", "electricity", "lighting", "environment", "waste", "mobility", "parking"].map((d) => (
              <button key={d} className={`chip${domain === d ? " on" : ""}`} onClick={() => setDomain(d)}>{DOMAINS[d].label}</button>
            ))}
          </div>
          <CityMap title="Live city map" tall center={center} devices={mapDevices} incidents={queue} onSelectIncident={setOpen} onSelectDevice={setDevice} />
        </div>

        <div className="stack">
          <div className="card">
            <h3>Incident queue <span className="hint" style={{ marginLeft: "auto" }}>{queue.length} shown</span></h3>
            <div className="chips" style={{ marginBottom: 12 }}>
              {SEV_ORDER.map((s) => (
                <button key={s} className={`chip${sev.includes(s) ? " on" : ""}`} style={sev.includes(s) ? { background: SEV_COLOR[s], borderColor: SEV_COLOR[s] } : undefined}
                  onClick={() => setSev((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s} ({count(s)})</button>
              ))}
            </div>
            <div style={{ maxHeight: 520, overflow: "auto", paddingRight: 4 }}>
              {queue.map((i) => {
                const t = timerOf.get(i.id);
                return (
                  <div key={i.id} className="alert-item" onClick={() => setOpen(i.id)} style={{ alignItems: "flex-start" }}>
                    <span className="sevdot" style={{ background: SEV_COLOR[i.severity], marginTop: 6 }} />
                    <div className="t">
                      <b>{i.title}</b>
                      <span>{i.ref} · {i.zone ?? "–"} · {timeAgo(i.createdAt)}</span>
                      <div className="row" style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}>
                        <SeverityBadge s={i.severity} /><StatusBadge s={i.status} />
                        {t && <SlaBadge r={i.status === "New" ? t.response : t.resolution} label={i.status === "New" ? "Resp" : "Res"} />}
                        {i.escalationLevel > 0 && <span className="badge red">L{i.escalationLevel}</span>}
                      </div>
                    </div>
                    {i.status === "New" && (
                      <button className="btn sm primary" disabled={busy === i.id} onClick={(e) => { e.stopPropagation(); void ack(i.id); }}>Ack</button>
                    )}
                  </div>
                );
              })}
              {!queue.length && <div className="empty">No open incidents match the filter</div>}
            </div>
          </div>

          <div className="card">
            <h3><Icon name="Radio" size={17} /> Live feed</h3>
            <div className="ticker">
              {feed.map((e, n) => (
                <div key={n}>
                  <time>{new Date(e.at).toLocaleTimeString()}</time>
                  <span>
                    <b style={{ textTransform: "capitalize" }}>{e.event}</b>{" "}
                    {e.data?.entity?.name ?? e.data?.entity?.id} {e.data?.type ? `· ${e.data.type}` : ""}
                  </span>
                </div>
              ))}
              {!feed.length && <div className="empty">Waiting for events…</div>}
            </div>
          </div>
        </div>
      </div>
      {open && <IncidentDrawer id={open} onClose={() => setOpen(undefined)} onChanged={reload} />}
      {device && <DeviceDrawer id={device} onClose={() => setDevice(undefined)} />}
    </Page>
  );
}
