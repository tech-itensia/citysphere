import { Fragment, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { Bar } from "../components/Charts";
import { useApi } from "../lib/useApi";
import { useLive } from "../lib/live";
import { DOMAINS, domainOf, fmt, statusTone, timeAgo } from "../lib/format";

/** Device detail with live values, metadata and 24/48 h history (SOW 4.4 b/c). */
export function DeviceDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [hours, setHours] = useState(24);
  const { data } = useApi<any>(`/twin/devices/${encodeURIComponent(id)}`, 15_000);
  const { data: hist } = useApi<Record<string, Array<{ ts: number; value: string }>>>(`/twin/devices/${encodeURIComponent(id)}/history?hours=${hours}`);
  const numericKeys = Object.keys(hist ?? {}).filter((k) => !Number.isNaN(Number(hist?.[k]?.[0]?.value)));
  const [key, setKey] = useState<string>();
  const k = key && numericKeys.includes(key) ? key : numericKeys[0];
  const series = (hist?.[k ?? ""] ?? []).map((p) => ({ t: new Date(p.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), v: Number(p.value) }));
  const s = data?.state;
  const meta = domainOf(s?.domain);

  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Asset details">
        <div className="row between">
          <span className="badge blue">{s?.deviceType ?? data?.profile ?? "Device"}</span>
          <button className="btn sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></button>
        </div>
        <h2 style={{ marginTop: 10 }} className="row"><Icon name={meta.icon} color={meta.color} size={22} /> {id}</h2>
        <div className="hint">{s?.zone ?? "–"} · last update {timeAgo(s?.ts)} {s?.online === false && <span className="badge red">Offline</span>}</div>

        <h3 className="mt" style={{ fontSize: 14 }}>Live values</h3>
        <div className="grid cols-3" style={{ gap: 10 }}>
          {Object.entries(s?.values ?? {}).filter(([kk]) => kk !== "ingestSource").map(([kk, v]) => (
            <div key={kk} className="card" style={{ padding: 12 }}>
              <div className="hint">{kk}</div>
              <b style={{ fontSize: 16 }}>{typeof v === "number" ? fmt(v, 2) : String(v)}</b>
            </div>
          ))}
        </div>

        {(data?.activeAlarms ?? []).length > 0 && (
          <>
            <h3 className="mt" style={{ fontSize: 14 }}>Active alarms</h3>
            {data.activeAlarms.map((a: any) => <div key={a.id?.id ?? a.type} className="alert-item"><div className="t"><b>{a.type}</b><span>{a.severity}</span></div></div>)}
          </>
        )}

        <div className="row between mt">
          <h3 style={{ fontSize: 14, margin: 0 }}>History</h3>
          <div className="seg">
            {[24, 48].map((h) => <button key={h} className={hours === h ? "on" : ""} onClick={() => setHours(h)}>{h}h</button>)}
          </div>
        </div>
        <div className="chips" style={{ margin: "10px 0" }}>
          {numericKeys.map((nk) => <button key={nk} className={`chip${nk === k ? " on" : ""}`} onClick={() => setKey(nk)}>{nk}</button>)}
        </div>
        <div style={{ height: 220 }}>
          {series.length ? (
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="rgba(15,23,42,.06)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 11, fill: "#64748b" }} minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} width={50} />
                <Tooltip />
                <Line type="monotone" dataKey="v" name={k} stroke={meta.color} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="empty">No history yet</div>}
        </div>

        {(data?.attributes ?? []).length > 0 && (
          <>
            <h3 className="mt" style={{ fontSize: 14 }}>Metadata</h3>
            <dl className="kv">{data.attributes.map((a: any) => <Fragment key={a.key}><dt>{a.key}</dt><dd>{String(a.value)}</dd></Fragment>)}</dl>
          </>
        )}
      </aside>
    </>
  );
}

/** Digital twin explorer: every asset on the map, filter by system, health per domain. */
export function Twin() {
  const { data: overview } = useApi<any>("/overview", 30_000);
  const { data: devices, setData } = useApi<any[]>("/twin/devices", 20_000);
  const [domain, setDomain] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string>();

  useLive((e) => {
    const d = e.event === "twin" ? e.data?.data : undefined;
    if (d?.deviceId) setData((list) => (list ?? []).map((x) => (x.deviceId === d.deviceId ? { ...x, values: { ...x.values, ...d.values }, ts: Date.now() } : x)));
  });

  const list = useMemo(() => (devices ?? []).filter((d) => (!domain || d.domain === domain) && (!q || d.deviceId.toLowerCase().includes(q.toLowerCase()))), [devices, domain, q]);
  const domains: any[] = overview?.twin?.domains ?? [];

  return (
    <Page title="Digital Twin" subtitle="Live 2D/2.5D model of city assets, their health and the last 48 hours of data.">
      <div className="grid side-main">
        <div className="stack">
          <div className="card">
            <h3>Systems health</h3>
            {domains.map((d) => {
              const m = domainOf(d.domain);
              return (
                <div key={d.domain} style={{ marginBottom: 12, cursor: "pointer" }} onClick={() => setDomain(domain === d.domain ? "" : d.domain)}>
                  <div className="row between" style={{ fontSize: 13, marginBottom: 6 }}>
                    <span className="row"><Icon name={m.icon} size={16} color={m.color} /> <b style={{ fontWeight: domain === d.domain ? 700 : 500 }}>{m.label}</b></span>
                    <span style={{ color: statusTone(d.healthPct) }}>{d.healthPct}% · {d.total}</span>
                  </div>
                  <Bar pct={d.healthPct} color={m.color} />
                </div>
              );
            })}
          </div>
          <div className="card">
            <h3>Assets <span className="hint" style={{ marginLeft: "auto" }}>{list.length}</span></h3>
            <label className="field"><input placeholder="Filter by device id" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <div style={{ maxHeight: 420, overflow: "auto", marginTop: 10 }}>
              {list.slice(0, 300).map((d) => {
                const m = domainOf(d.domain);
                return (
                  <div key={d.deviceId} className="alert-item" onClick={() => setSel(d.deviceId)}>
                    <span className="ic" style={{ background: `${m.color}1a` }}><Icon name={m.icon} size={16} color={m.color} /></span>
                    <div className="t"><b>{d.deviceId}</b><span>{d.deviceType} · {d.zone ?? "–"}</span></div>
                    {(d.alarms ?? []).length > 0 ? <span className="badge red">{d.alarms.length} alarm</span> : <span className="when">{timeAgo(d.ts)}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="chips" style={{ marginBottom: 12 }}>
            <button className={`chip${!domain ? " on" : ""}`} onClick={() => setDomain("")}>All</button>
            {Object.keys(DOMAINS).filter((k) => k !== "generic").map((k) => (
              <button key={k} className={`chip${domain === k ? " on" : ""}`} onClick={() => setDomain(k)}>{DOMAINS[k].label}</button>
            ))}
          </div>
          <CityMap title="Asset map" tall center={overview?.tenant?.center ?? { lat: 28.6139, lon: 77.209 }} devices={list} onSelectDevice={setSel} />
        </div>
      </div>
      {sel && <DeviceDrawer id={sel} onClose={() => setSel(undefined)} />}
    </Page>
  );
}
