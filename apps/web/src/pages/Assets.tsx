import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { DeviceStatusBadge, Online, SeverityBadge, StatusBadge } from "../components/Badges";
import { Tabs, useTab, Kpi, Modal, ErrorNote } from "../components/Ui";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { apiGet, apiSend } from "../lib/api";
import { DEVICE_STATUSES, PROTOCOL_LABEL, domainOf, fmt, timeAgo, downloadCsv } from "../lib/format";

const canWrite = (roles: string[]) => roles.some((r) => ["city_admin", "it_ops", "super_admin"].includes(r));
const DEVICE_ACTIONS: Record<string, Array<[string, string]>> = {
  Discovered: [["register", "Register as is"]], Registered: [["commission", "Commission"]], Provisioned: [["commission", "Commission"]],
  Active: [["maintenance", "Start maintenance"], ["fault", "Mark faulty"]], Maintenance: [["restore", "End maintenance"], ["fault", "Mark faulty"]],
  Faulty: [["restore", "Restore"], ["maintenance", "Maintenance"]], Decommissioned: [],
};

/** Assets & devices (SOW 4.4 + device mapping): registry, hierarchy, discovered queue, CSV import, mapping profiles, catalogue. */
export function Assets() {
  const { me } = useAuth();
  const nav = useNavigate();
  const write = canWrite(me?.roles ?? []);
  const [tab, setTab] = useTab("registry", ["registry", "hierarchy", "discovered", "import", "mapping", "catalog"]);
  const { data: summary, reload: reloadSummary } = useApi<any>("/assets/summary", 30_000);
  const [selected, setSelected] = useState<string>();

  return (
    <Page title="Assets & devices" subtitle="Every device mapped to its zone, site, physical asset and owning department."
      actions={write && <><button className="btn primary" onClick={() => nav("/assets/onboard")}><Icon name="Plus" size={16} /> Onboard device</button><button className="btn" onClick={() => setTab("import")}><Icon name="Upload" size={16} /> Bulk import</button></>}>
      <div className="grid cols-6k">
        <Kpi label="Registered devices" icon="Cpu" value={fmt(summary?.registered)} sub={summary?.quota ? `quota ${fmt(summary.quota)}` : undefined} />
        <Kpi label="Online" icon="Wifi" value={fmt(summary?.online)} tone="#16a34a" sub="reported in 15 min" />
        <Kpi label="Offline" icon="WifiOff" value={fmt(summary?.offline)} tone={summary?.offline ? "#ea580c" : undefined} />
        <Kpi label="Discovered, unmapped" icon="Radio" value={fmt(summary?.discovered)} tone={summary?.discovered ? "#ea580c" : undefined} sub={summary?.discovered ? <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => setTab("discovered")}>Map them →</a> : "all mapped"} />
        <Kpi label="Sites · assets" icon="Building" value={`${fmt(summary?.sites)} · ${fmt(summary?.assets)}`} />
        <Kpi label="Mapping profiles" icon="GitBranch" value={fmt(summary?.mappingProfiles)} />
      </div>
      <div className="mt">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "registry", label: "Registry", icon: "Database" }, { id: "hierarchy", label: "Hierarchy", icon: "Network" },
          { id: "discovered", label: "Discovered", icon: "Radio", count: summary?.discovered }, { id: "import", label: "Bulk import", icon: "Upload" },
          { id: "mapping", label: "Mapping profiles", icon: "GitBranch" }, { id: "catalog", label: "Device catalogue", icon: "Package" },
        ]} />
        {tab === "registry" && <Registry onOpen={setSelected} summary={summary} />}
        {tab === "hierarchy" && <Hierarchy onOpen={setSelected} />}
        {tab === "discovered" && <Discovered onOpen={setSelected} write={write} />}
        {tab === "import" && <BulkImport onDone={reloadSummary} write={write} />}
        {tab === "mapping" && <MappingProfiles write={write} />}
        {tab === "catalog" && <Catalog />}
      </div>
      {selected && <RegistryDrawer id={selected} onClose={() => setSelected(undefined)} onChanged={reloadSummary} />}
    </Page>
  );
}

// ---------------------------------------------------------------- registry table + map
function Registry({ onOpen, summary }: { onOpen: (id: string) => void; summary?: any }) {
  const { me } = useAuth();
  const [f, setF] = useState({ status: "", type: "", zone: "", department: "", q: "", offline: false });
  const qs = new URLSearchParams({ limit: "1000" });
  if (f.status) qs.set("status", f.status);
  if (f.type) qs.set("type", f.type);
  if (f.zone) qs.set("zone", f.zone);
  if (f.department) qs.set("department", f.department);
  if (f.q) qs.set("q", f.q);
  if (f.offline) qs.set("offline", "true");
  const { data } = useApi<any[]>(`/assets/devices?${qs}`, 30_000);
  const [view, setView] = useState<"table" | "map">("table");
  const keys = (k: string) => (summary?.[k] ?? []).map((x: any) => x.key).filter((x: string) => x !== "Unassigned");
  return (
    <div className="card">
      <div className="filters">
        <label className="field">Search<input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="ID, name or serial" /></label>
        <label className="field">Status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any (not retired)</option>{DEVICE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="field">Type<select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Any</option>{keys("byType").map((t: string) => <option key={t}>{t}</option>)}</select></label>
        <label className="field">Zone<select value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}><option value="">Any</option>{keys("byZone").map((t: string) => <option key={t}>{t}</option>)}</select></label>
        <label className="field">Department<select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">Any</option>{keys("byDepartment").map((t: string) => <option key={t}>{t}</option>)}</select></label>
        <label className="row" style={{ fontSize: 13, gap: 6 }}><input type="checkbox" checked={f.offline} onChange={(e) => setF({ ...f, offline: e.target.checked })} /> Offline only</label>
        <div className="seg" style={{ marginLeft: "auto" }}><button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button><button className={view === "map" ? "on" : ""} onClick={() => setView("map")}>Map</button></div>
        <button className="btn sm" onClick={() => downloadCsv("devices.csv", (data ?? []).map(({ deviceId, name, deviceType, status, zone, siteName, assetName, department, vendor, serial, protocol, lastSeen }) => ({ deviceId, name, deviceType, status, zone, site: siteName, asset: assetName, department, vendor, serial, protocol, lastSeen })))}><Icon name="Download" size={14} /> CSV</button>
      </div>
      {view === "map" ? (
        <CityMap center={me?.city?.center ?? { lat: 28.6139, lon: 77.209 }} devices={(data ?? []).map((d) => ({ ...d, alarms: d.status === "Faulty" ? ["fault"] : [] }))} onSelectDevice={onOpen} height={520} live={false} />
      ) : (
        <div style={{ overflow: "auto", maxHeight: 620 }}>
          <table className="tbl">
            <thead><tr><th>Device</th><th>Type</th><th>Status</th><th>Mapping (zone › site › asset)</th><th>Department</th><th>Connectivity</th><th>Last seen</th></tr></thead>
            <tbody>
              {(data ?? []).map((d) => {
                const m = domainOf(d.domain);
                return (
                  <tr key={d.deviceId} className="click" onClick={() => onOpen(d.deviceId)}>
                    <td><div className="row" style={{ gap: 8 }}><Icon name={m.icon} size={16} color={m.color} /><div><b className="mono">{d.deviceId}</b><div className="hint">{d.name ?? d.vendor ?? ""}</div></div></div></td>
                    <td>{d.deviceType}</td><td><DeviceStatusBadge s={d.status} /></td>
                    <td style={{ fontSize: 12.5 }}>{[d.zone, d.siteName, d.assetName].filter(Boolean).join(" › ") || <span className="badge amber">Not mapped</span>}</td>
                    <td>{d.department ?? "–"}</td>
                    <td><span className="hint">{PROTOCOL_LABEL[d.protocol] ?? d.protocol}</span></td>
                    <td>{d.status === "Decommissioned" ? "–" : <><Online on={d.online} /> <span className="hint">{timeAgo(d.lastSeen)}</span></>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data?.length && <div className="empty">No devices match</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- hierarchy tree
function Hierarchy({ onOpen }: { onOpen: (id: string) => void }) {
  const { data } = useApi<any>("/assets/hierarchy", 60_000);
  const [openZones, setOpenZones] = useState<string[]>([]);
  const [openSites, setOpenSites] = useState<string[]>([]);
  const toggle = (list: string[], set: (x: string[]) => void, k: string) => set(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const dev = (d: any) => {
    const m = domainOf(d.domain);
    return <li key={d.deviceId}><span className="node" onClick={() => onOpen(d.deviceId)}><Icon name={m.icon} size={13} color={m.color} /><span className="mono">{d.deviceId}</span><DeviceStatusBadge s={d.status} />{d.online === false && d.status !== "Discovered" && <span className="hint">offline</span>}</span></li>;
  };
  const siteNode = (s: any) => (
    <li key={s.id}>
      <span className="node" onClick={() => toggle(openSites, setOpenSites, s.id)}><Icon name={openSites.includes(s.id) ? "ChevronDown" : "ChevronRight"} size={13} /><Icon name="MapPin" size={13} color="#4f46e5" /><b>{s.name}</b><span className="hint">{s.kind} · {s.assets.length} assets</span></span>
      {openSites.includes(s.id) && (
        <ul className="tree">
          {s.assets.map((a: any) => (
            <li key={a.id}><span className="node"><Icon name="Box" size={13} color="#0ea5e9" />{a.name}<span className="hint">{a.department ?? ""} · {a.criticality}</span></span><ul className="tree">{a.devices.map(dev)}</ul></li>
          ))}
          {(s.devices ?? []).map(dev)}
        </ul>
      )}
    </li>
  );
  const count = (z: any) => z.sites.reduce((n: number, s: any) => n + s.assets.reduce((k: number, a: any) => k + a.devices.length, 0) + (s.devices?.length ?? 0), 0) + z.devices.length;
  return (
    <div className="grid cols-2">
      <div className="card">
        <h3><Icon name="Network" size={16} /> Zone › Site › Asset › Device</h3>
        <ul className="tree" style={{ borderLeft: 0, paddingLeft: 0 }}>
          {(data?.zones ?? []).map((z: any) => (
            <li key={z.zone}>
              <span className="node" onClick={() => toggle(openZones, setOpenZones, z.zone)}><Icon name={openZones.includes(z.zone) ? "ChevronDown" : "ChevronRight"} size={14} /><Icon name="Map" size={14} color="#2563eb" /><b>{z.zone}</b><span className="hint">{z.sites.length} sites · {count(z)} devices</span></span>
              {openZones.includes(z.zone) && <ul className="tree">{z.sites.map(siteNode)}{z.devices.map(dev)}</ul>}
            </li>
          ))}
          {(data?.citywide ?? []).length > 0 && (
            <li><span className="node" onClick={() => toggle(openZones, setOpenZones, "__city")}><Icon name={openZones.includes("__city") ? "ChevronDown" : "ChevronRight"} size={14} /><Icon name="Globe" size={14} color="#2563eb" /><b>City-wide</b><span className="hint">fleets and city stations</span></span>
              {openZones.includes("__city") && <ul className="tree">{data.citywide.map(siteNode)}</ul>}</li>
          )}
          {(data?.unplaced ?? []).length > 0 && <li><span className="node"><Icon name="AlertTriangle" size={14} color="#ea580c" /><b>Not placed</b></span><ul className="tree">{data.unplaced.map(dev)}</ul></li>}
        </ul>
      </div>
      <div className="card">
        <h3>How mapping is used</h3>
        <div className="check"><Icon name="AlertTriangle" size={18} color="#ef4444" /><div><b>Incidents</b><div className="hint">An alarm on a device opens an incident with its zone, site, asset and the owning department already filled in.</div></div></div>
        <div className="check"><Icon name="ClipboardList" size={18} color="#4f46e5" /><div><b>Work orders</b><div className="hint">Crews see the exact asset and its location; the department routes the job.</div></div></div>
        <div className="check"><Icon name="Wrench" size={18} color="#f59e0b" /><div><b>Maintenance mode</b><div className="hint">Devices under planned maintenance keep reporting but never page the command centre.</div></div></div>
        <div className="check"><Icon name="GitBranch" size={18} color="#0ea5e9" /><div><b>Mapping profiles</b><div className="hint">Vendor payload keys are translated to canonical keys in the stream before ThingsBoard, the twin or rules see them.</div></div></div>
        <div className="check"><Icon name="Layers" size={18} color="#22c55e" /><div><b>Digital twin</b><div className="hint">Fixed assets always show at their registered position, moving ones at their live position.</div></div></div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- discovered queue
function Discovered({ onOpen, write }: { onOpen: (id: string) => void; write: boolean }) {
  const nav = useNavigate();
  const { data } = useApi<any[]>("/assets/devices?status=Discovered", 20_000);
  return (
    <div className="card">
      <h3><Icon name="Radio" size={16} /> Devices sending data that are not in the registry</h3>
      <p className="hint" style={{ marginTop: -6 }}>Data from these devices still flows to Kafka and the twin. Map each one to a site, asset and department so its alarms are routed correctly.</p>
      <table className="tbl"><thead><tr><th>Device</th><th>Guessed type</th><th>First seen</th><th>Last seen</th><th>Position</th><th></th></tr></thead><tbody>
        {(data ?? []).map((d) => (
          <tr key={d.deviceId}>
            <td className="mono"><a style={{ cursor: "pointer" }} onClick={() => onOpen(d.deviceId)}>{d.deviceId}</a></td><td>{d.deviceType}</td><td>{timeAgo(d.firstSeen)}</td><td>{timeAgo(d.lastSeen)}</td>
            <td className="hint">{d.lat ? `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}` : "–"}{d.zone ? ` · ${d.zone}` : ""}</td>
            <td>{write && <button className="btn sm primary" onClick={() => nav(`/assets/onboard?map=${encodeURIComponent(d.deviceId)}`)}><Icon name="Link" size={14} /> Map device</button>}</td>
          </tr>
        ))}
      </tbody></table>
      {!data?.length && <div className="empty">Nothing waiting. Every reporting device is mapped.</div>}
    </div>
  );
}

// ---------------------------------------------------------------- CSV import with validation preview
function BulkImport({ onDone, write }: { onDone: () => void; write: boolean }) {
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<any>();
  const [result, setResult] = useState<any>();
  const [err, setErr] = useState<string>();
  async function template() { const t = await apiGet<string>("/assets/import-template"); setCsv(typeof t === "string" ? t : String(t)); }
  async function validate() { setErr(undefined); setResult(undefined); try { setReport(await apiSend("POST", "/assets/devices/import?dryRun=true", { csv })); } catch (e) { setErr((e as Error).message); } }
  async function run() { setErr(undefined); try { setResult(await apiSend("POST", "/assets/devices/import", { csv })); setReport(undefined); onDone(); } catch (e) { setErr((e as Error).message); } }
  function file(f?: File) { if (!f) return; const r = new FileReader(); r.onload = () => setCsv(String(r.result ?? "")); r.readAsText(f); }
  return (
    <div className="grid main-side">
      <div className="card">
        <h3><Icon name="Upload" size={16} /> Paste or upload a CSV</h3>
        <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          <label className="btn sm"><Icon name="FileText" size={14} /> Choose file<input type="file" accept=".csv,text/csv" hidden onChange={(e) => file(e.target.files?.[0])} /></label>
          <button className="btn sm" onClick={template}><Icon name="Download" size={14} /> Load template</button>
        </div>
        <textarea className="code" style={{ width: "100%", minHeight: 220, border: "1px solid var(--line)" }} value={csv} onChange={(e) => { setCsv(e.target.value); setReport(undefined); }} placeholder="deviceId,name,deviceType,serial,vendor,model,firmware,protocol,zone,site,asset,department,criticality,lat,lon" />
        <div className="row mt">
          <button className="btn" disabled={csv.length < 10} onClick={validate}><Icon name="ListChecks" size={15} /> Validate</button>
          <button className="btn primary" disabled={!write || !report || report.invalid > 0 || !report.valid} onClick={run}>Import {report?.valid ?? ""} devices</button>
        </div>
        <ErrorNote msg={err} />
        {result && <div className="badge green" style={{ marginTop: 10 }}>Imported: {result.created} created, {result.updated} updated. New devices are Registered; provision or commission them next.</div>}
      </div>
      <div className="card">
        <h3>Validation</h3>
        {!report && <div className="hint">Validate first. Every row is checked against the device catalogue (type, protocol, criticality, coordinates, duplicates) before anything is written. Sites and assets named in the file are created automatically.</div>}
        {report && (
          <>
            <div className="row" style={{ gap: 8 }}><span className="badge green">{report.valid} valid</span><span className={`badge ${report.invalid ? "red" : "grey"}`}>{report.invalid} with problems</span></div>
            {report.issues?.map((i: any, n: number) => <div key={n} className="alert-item"><span className="badge red">line {i.line}</span><div className="t"><b>{i.deviceId ?? ""} {i.field ? `· ${i.field}` : ""}</b><span>{i.message}</span></div></div>)}
            <table className="tbl mt"><thead><tr><th>Device</th><th>Type</th><th>Action</th></tr></thead><tbody>
              {(report.preview ?? []).slice(0, 30).map((r: any) => <tr key={r.deviceId}><td className="mono">{r.deviceId}</td><td>{r.deviceType}</td><td><span className={`badge ${r.action === "create" ? "blue" : "amber"}`}>{r.action}</span></td></tr>)}
            </tbody></table>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- mapping profiles editor
function MappingProfiles({ write }: { write: boolean }) {
  const { data, reload } = useApi<any[]>("/assets/mapping-profiles");
  const { data: catalog } = useApi<any[]>("/assets/catalog");
  const [edit, setEdit] = useState<any>();
  const [sample, setSample] = useState('{ "pm2_5_ugm3": 48, "temp_f": 86, "rssi": -70 }');
  const preview = useMemo(() => {
    try {
      const v = JSON.parse(sample);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        const r = (edit?.rules ?? []).find((x: any) => x.from === k);
        if (r?.drop) continue;
        if (!r) { out[k] = val; continue; }
        out[r.to || k] = typeof val === "number" && (r.scale !== undefined || r.offset !== undefined) ? Math.round(((val as number) * (r.scale ?? 1) + (r.offset ?? 0)) * 100) / 100 : val;
      }
      return JSON.stringify(out, null, 2);
    } catch { return "Sample is not valid JSON"; }
  }, [sample, edit]);
  async function save() {
    const body = { name: edit.name, vendor: edit.vendor || undefined, deviceType: edit.deviceType || undefined, rules: edit.rules.filter((r: any) => r.from).map((r: any) => ({ from: r.from, to: r.to ?? "", ...(r.scale !== "" && r.scale !== undefined ? { scale: Number(r.scale) } : {}), ...(r.offset !== "" && r.offset !== undefined ? { offset: Number(r.offset) } : {}), ...(r.drop ? { drop: true } : {}) })) };
    if (edit.id) await apiSend("PUT", `/assets/mapping-profiles/${edit.id}`, body); else await apiSend("POST", "/assets/mapping-profiles", body);
    setEdit(undefined); await reload();
  }
  const setRule = (n: number, k: string, v: any) => setEdit((e: any) => ({ ...e, rules: e.rules.map((r: any, i: number) => (i === n ? { ...r, [k]: v } : r)) }));
  return (
    <div className="grid main-side">
      <div className="card">
        <h3><Icon name="GitBranch" size={16} /> Vendor key → canonical key {write && <button className="btn sm primary" style={{ marginLeft: "auto" }} onClick={() => setEdit({ name: "", vendor: "", deviceType: "", rules: [{ from: "", to: "" }] })}><Icon name="Plus" size={14} /> New profile</button>}</h3>
        <table className="tbl"><thead><tr><th>Profile</th><th>Vendor</th><th>Device type</th><th>Rules</th><th>Devices</th><th></th></tr></thead><tbody>
          {(data ?? []).map((p) => (
            <tr key={p.id}><td><b>{p.name}</b></td><td>{p.vendor ?? "–"}</td><td>{p.deviceType ?? "Any"}</td>
              <td style={{ fontSize: 12 }}>{p.rules.map((r: any) => r.drop ? `drop ${r.from}` : `${r.from} → ${r.to}${r.scale !== undefined ? ` ×${r.scale}` : ""}${r.offset !== undefined ? ` +${r.offset}` : ""}`).join(", ")}</td>
              <td>{p.devices ?? 0}</td>
              <td>{write && <><button className="btn sm" onClick={() => setEdit({ ...p, rules: p.rules.map((r: any) => ({ ...r })) })}>Edit</button> <button className="btn sm danger" onClick={async () => { await apiSend("DELETE", `/assets/mapping-profiles/${p.id}`); await reload(); }}>Delete</button></>}</td></tr>
          ))}
        </tbody></table>
        {!data?.length && <div className="empty">No profiles yet</div>}
      </div>
      <div className="card">
        <h3>Why mapping profiles</h3>
        <p className="hint">Each vendor names readings differently. A profile translates a payload once, in the normalizer stream, so ThingsBoard alarm rules, the twin, correlation and analytics all see the same canonical keys (pm25, pressureBar, temperatureC…). Assign a profile to a device in its drawer or in the onboarding wizard.</p>
      </div>
      {edit && (
        <Modal wide title={edit.id ? `Edit ${edit.name}` : "New mapping profile"} onClose={() => setEdit(undefined)} footer={<><button className="btn" onClick={() => setEdit(undefined)}>Cancel</button><button className="btn primary" disabled={!edit.name || !edit.rules.some((r: any) => r.from)} onClick={save}>Save profile</button></>}>
          <div className="grid cols-3" style={{ gap: 12 }}>
            <label className="field">Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field">Vendor<input value={edit.vendor ?? ""} onChange={(e) => setEdit({ ...edit, vendor: e.target.value })} /></label>
            <label className="field">Device type<select value={edit.deviceType ?? ""} onChange={(e) => setEdit({ ...edit, deviceType: e.target.value })}><option value="">Any</option>{(catalog ?? []).map((c) => <option key={c.name}>{c.name}</option>)}</select></label>
          </div>
          <table className="tbl mt"><thead><tr><th>Vendor key</th><th>Canonical key</th><th>× scale</th><th>+ offset</th><th>Drop</th><th></th></tr></thead><tbody>
            {edit.rules.map((r: any, n: number) => (
              <tr key={n}>
                <td><input className="field-input" value={r.from} onChange={(e) => setRule(n, "from", e.target.value)} placeholder="press_kpa" /></td>
                <td><input className="field-input" value={r.to ?? ""} onChange={(e) => setRule(n, "to", e.target.value)} placeholder="pressureBar" list="canonical-keys" /></td>
                <td><input className="field-input" style={{ width: 80 }} value={r.scale ?? ""} onChange={(e) => setRule(n, "scale", e.target.value)} /></td>
                <td><input className="field-input" style={{ width: 80 }} value={r.offset ?? ""} onChange={(e) => setRule(n, "offset", e.target.value)} /></td>
                <td><input type="checkbox" checked={!!r.drop} onChange={(e) => setRule(n, "drop", e.target.checked)} /></td>
                <td><button className="btn sm" onClick={() => setEdit({ ...edit, rules: edit.rules.filter((_: any, i: number) => i !== n) })}><Icon name="X" size={13} /></button></td>
              </tr>
            ))}
          </tbody></table>
          <datalist id="canonical-keys">{[...new Set((catalog ?? []).flatMap((c) => c.telemetry))].map((k) => <option key={k as string} value={k as string} />)}</datalist>
          <button className="btn sm mt" onClick={() => setEdit({ ...edit, rules: [...edit.rules, { from: "", to: "" }] })}><Icon name="Plus" size={13} /> Add rule</button>
          <div className="grid cols-2 mt" style={{ gap: 12 }}>
            <label className="field">Try a vendor payload<textarea className="code" rows={6} value={sample} onChange={(e) => setSample(e.target.value)} /></label>
            <label className="field">What the platform will see<pre className="code" style={{ margin: 0, minHeight: 120 }}>{preview}</pre></label>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- catalogue
export function Catalog() {
  const { data } = useApi<any[]>("/assets/catalog");
  return (
    <div className="grid cols-3">
      {(data ?? []).map((t) => {
        const m = domainOf(t.domain);
        return (
          <div key={t.name} className="card">
            <h3 className="row"><Icon name={m.icon} size={18} color={m.color} /> {t.name} <span className="badge grey" style={{ marginLeft: "auto" }}>{t.prefix}</span></h3>
            <div className="hint">{t.description}</div>
            <div className="mt" style={{ fontSize: 12.5 }}><b>Telemetry</b><div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>{t.telemetry.map((k: string) => <span key={k} className="badge blue">{k}</span>)}</div></div>
            {t.alarms.length > 0 && <div className="mt" style={{ fontSize: 12.5 }}><b>Alarm rules (ThingsBoard profile)</b>
              {t.alarms.map((a: any) => <div key={a.type} className="hint">{a.type}: {Object.entries(a.create).map(([sev, c]: [string, any]) => `${sev} if ${c.key} ${c.op.replace("_OR_EQUAL", "≥").replace("GREATER", ">").replace("LESS", "<").replace("EQUAL", "=")} ${c.value}${c.minutes ? ` for ${c.minutes} min` : ""}`).join("; ")}</div>)}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- device drawer (registry view)
export function RegistryDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: () => void }) {
  const { me } = useAuth();
  const nav = useNavigate();
  const write = canWrite(me?.roles ?? []);
  const { data: d, reload, setData } = useApi<any>(`/assets/devices/${encodeURIComponent(id)}`, 15_000);
  const { data: incidents } = useApi<any[]>(`/incidents?deviceId=${encodeURIComponent(id)}&limit=10&sort=recent`);
  const { data: profiles } = useApi<any[]>(write ? "/assets/mapping-profiles" : null);
  const [creds, setCreds] = useState<any>();
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  async function act(action: string) {
    setMsg(undefined);
    try { const r = await apiSend<any>("POST", `/assets/devices/${encodeURIComponent(id)}/transition`, { action }); setData((x: any) => ({ ...x, ...r })); await reload(); onChanged?.(); setMsg({ ok: true, text: `Device is now ${r.status}` }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  async function provision() {
    setMsg(undefined);
    try { const r = await apiSend<any>("POST", `/assets/devices/${encodeURIComponent(id)}/provision`); setCreds(r); await reload(); onChanged?.(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  async function setProfile(profileId: string) {
    await apiSend("PUT", `/assets/devices/${encodeURIComponent(id)}`, { profileId: profileId || null }); await reload();
  }
  const m = domainOf(d?.domain);
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Device">
        <div className="row between"><span className="badge blue">{d?.deviceType ?? "Device"}</span><button className="btn sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></button></div>
        {!d ? <div className="empty">Loading…</div> : (
          <>
            <h2 className="row" style={{ marginTop: 10 }}><Icon name={m.icon} size={22} color={m.color} /><span className="mono">{d.deviceId}</span></h2>
            <div className="row" style={{ flexWrap: "wrap" }}><DeviceStatusBadge s={d.status} />{d.status !== "Decommissioned" && <Online on={d.online} />}<span className="hint">{d.name}</span></div>
            <div className="card mt" style={{ padding: 12 }}>
              <div className="hint" style={{ marginBottom: 6 }}>Mapping</div>
              <div className="chain">{["Zone", "Site", "Asset", "Department"].map((label, n) => {
                const v = [d.zone, d.siteName, d.assetName, d.department][n];
                return <span key={label} className="row" style={{ gap: 6 }}><span className="hint">{label}</span><b>{v ?? "—"}</b>{n < 3 && <span className="sep">›</span>}</span>;
              })}</div>
              {write && <button className="btn sm mt" onClick={() => nav(`/assets/onboard?map=${encodeURIComponent(d.deviceId)}`)}><Icon name="Link" size={13} /> Change mapping</button>}
            </div>
            <dl className="kv">
              <dt>Vendor / model</dt><dd>{[d.vendor, d.model].filter(Boolean).join(" · ") || "–"}</dd>
              <dt>Serial</dt><dd className="mono">{d.serial ?? "–"}</dd>
              <dt>Firmware</dt><dd>{d.firmware ?? "–"}</dd>
              <dt>Connectivity</dt><dd>{PROTOCOL_LABEL[d.protocol] ?? d.protocol}{d.tbDeviceId ? " · in ThingsBoard" : ""}</dd>
              <dt>Criticality</dt><dd><SeverityBadge s={d.criticality} /></dd>
              <dt>First / last seen</dt><dd>{d.firstSeen ? timeAgo(d.firstSeen) : "never"} / {d.lastSeen ? timeAgo(d.lastSeen) : "never"}</dd>
              <dt>Installed</dt><dd>{d.installedAt ?? "–"}</dd>
              <dt>Position</dt><dd>{d.lat ? `${Number(d.lat).toFixed(5)}, ${Number(d.lon).toFixed(5)}` : "–"}</dd>
            </dl>
            {write && (
              <label className="field">Mapping profile
                <select value={d.profileId ?? ""} onChange={(e) => setProfile(e.target.value)}><option value="">None (keys used as sent)</option>{(profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
            )}
            <div className="row mt" style={{ flexWrap: "wrap" }}>
              {d.status === "Discovered" && write && <button className="btn sm primary" onClick={() => nav(`/assets/onboard?map=${encodeURIComponent(d.deviceId)}`)}><Icon name="Link" size={14} /> Map device</button>}
              {write && ["Registered", "Provisioned", "Active", "Maintenance", "Faulty"].includes(d.status) && <button className="btn sm" onClick={provision}><Icon name="KeyRound" size={14} /> {d.tbDeviceId ? "Rotate ThingsBoard token" : "Provision in ThingsBoard"}</button>}
              {(DEVICE_ACTIONS[d.status] ?? []).filter(([a]) => write || ["maintenance", "fault", "restore", "commission"].includes(a)).map(([a, l]) => <button key={a} className={`btn sm${a === "commission" ? " primary" : ""}`} onClick={() => act(a)}>{l}</button>)}
              {write && d.status !== "Decommissioned" && <button className="btn sm danger" onClick={() => act("decommission")}><Icon name="Ban" size={14} /> Decommission</button>}
            </div>
            {msg && <div className={`badge ${msg.ok ? "green" : "red"}`} style={{ marginTop: 8, display: "inline-block" }}>{msg.text}</div>}
            {creds && <Credentials r={creds} />}
            {d.telemetryKeys?.length > 0 && <div className="mt" style={{ fontSize: 12.5 }}><b>Expected telemetry</b><div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>{d.telemetryKeys.map((k: string) => <span key={k} className="badge blue">{k}</span>)}</div></div>}
            <h3 className="mt" style={{ fontSize: 14 }}>Incidents on this device</h3>
            {(incidents ?? []).map((i) => <div key={i.id} className="alert-item"><div className="t"><b>{i.title}</b><span>{i.ref} · {timeAgo(i.createdAt)}</span></div><StatusBadge s={i.status} /></div>)}
            {!incidents?.length && <div className="hint">None</div>}
            <h3 className="mt" style={{ fontSize: 14 }}>History</h3>
            <div className="timeline">{(d.events ?? []).map((e: any, n: number) => <div key={n} className="ev"><b style={{ textTransform: "capitalize" }}>{String(e.type).replace("status.", "").replace(".", " ")}</b>{e.data?.to ? ` → ${e.data.to}` : ""}{e.data?.keys ? ` · keys: ${e.data.keys.join(", ")}` : ""}<span>{e.actor} · {new Date(e.at).toLocaleString()}</span></div>)}</div>
          </>
        )}
      </aside>
    </>
  );
}

export function Credentials({ r }: { r: any }) {
  const c = r.connection ?? {};
  return (
    <div className="card mt" style={{ padding: 12, background: "#f0fdf4" }}>
      <b><Icon name="KeyRound" size={14} /> Access token (shown once)</b>
      <div className="code" style={{ marginTop: 6 }}>{r.token}</div>
      {c.mqtt && <><div className="hint mt">MQTT · host {c.mqtt.host}:{c.mqtt.port} · username = token · topic {c.mqtt.topic}</div><div className="code">{JSON.stringify(c.mqtt.payload)}</div></>}
      {c.http && <><div className="hint mt">HTTP to ThingsBoard</div><div className="code">{c.http.curl}</div></>}
      {c.ingest && <><div className="hint mt">Or via the ingest API (to Kafka) with a city API key</div><div className="code">{c.ingest.curl}</div></>}
    </div>
  );
}

