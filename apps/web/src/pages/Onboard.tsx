import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { Stepper, ErrorNote } from "../components/Ui";
import { DeviceStatusBadge } from "../components/Badges";
import { Credentials } from "./Assets";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { apiGet, apiSend } from "../lib/api";
import { PROTOCOL_LABEL, domainOf, timeAgo } from "../lib/format";

const STEPS = ["Device type", "Identity", "Location", "Ownership", "Connectivity", "Verify & commission"];
const PROTOCOLS: Array<[string, string, string]> = [
  ["mqtt", "MQTT to ThingsBoard", "Device publishes to v1/devices/me/telemetry with its access token. Best for smart sensors and gateways."],
  ["http", "HTTP to ThingsBoard", "Device posts JSON to ThingsBoard's device API with its access token."],
  ["http-ingest", "HTTP ingest API → Kafka", "Device or vendor platform posts to the SCaaS ingest service with a city API key. Lands on Kafka first."],
  ["kafka", "Kafka topic", "An integration produces straight to scaas.raw.telemetry using the event envelope."],
  ["connector", "Vendor connector", "Data is pulled from a vendor cloud by connector-service (weather, traffic, CSV batches)."],
];
function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371e3, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Device onboarding wizard (6 steps). With ?map=<deviceId> it maps an existing or Discovered device instead. */
export function Onboard() {
  const { me } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const mapId = params.get("map") ?? undefined;
  const { data: catalog } = useApi<any[]>("/assets/catalog");
  const { data: tenant } = useApi<any>(me ? `/tenants/${me.tenantId}` : null);
  const { data: depts } = useApi<any[]>("/departments");
  const { data: profiles } = useApi<any[]>("/assets/mapping-profiles");
  const [step, setStep] = useState(0);
  const [f, setF] = useState<any>({ deviceType: "", deviceId: "", name: "", serial: "", vendor: "", model: "", firmware: "", criticality: "Medium",
    lat: undefined, lon: undefined, zone: "", siteId: "", siteName: "", assetId: "", assetName: "", assetKind: "", department: "", installedAt: new Date().toISOString().slice(0, 10), notes: "", protocol: "mqtt", profileId: "" });
  const [existing, setExisting] = useState<any>();
  const [creds, setCreds] = useState<any>();
  const [saved, setSaved] = useState<any>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const zones: Array<{ name: string; lat: number; lon: number }> = tenant?.zones ?? [];
  const { data: sites } = useApi<any[]>(f.zone ? `/assets/sites?zone=${encodeURIComponent(f.zone)}` : "/assets/sites");
  const { data: siteAssets } = useApi<any[]>(f.siteId ? `/assets/assets?siteId=${f.siteId}` : null);
  const type = (catalog ?? []).find((c) => c.name === f.deviceType);

  // mapping an existing / discovered device: prefill
  useEffect(() => {
    if (!mapId) return;
    void apiGet<any>(`/assets/devices/${encodeURIComponent(mapId)}`).then((d) => {
      if (!d) return;
      setExisting(d);
      setF((x: any) => ({ ...x, deviceId: d.deviceId, deviceType: d.deviceType, name: d.name ?? "", serial: d.serial ?? "", vendor: d.vendor ?? "", model: d.model ?? "", firmware: d.firmware ?? "",
        criticality: d.criticality ?? "Medium", lat: d.lat, lon: d.lon, zone: d.zone ?? "", siteId: d.siteId ?? "", assetId: d.assetId ?? "", department: d.department ?? "", protocol: d.protocol ?? "http-ingest", profileId: d.profileId ?? "" }));
      setStep(d.status === "Discovered" ? 0 : 2);
    }).catch(() => undefined);
  }, [mapId]);

  // sensible defaults from the catalogue
  useEffect(() => {
    if (!type || mapId) return;
    if (!f.deviceId) set("deviceId", `${type.prefix}-`);
    const d = (depts ?? []).find((x) => x.categories?.includes(type.domain));
    if (d && !f.department) set("department", d.name);
    if (["mobility", "emergency"].includes(type.domain)) set("protocol", "mqtt");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.deviceType, depts]);

  function pick(lat: number, lon: number) {
    set("lat", Math.round(lat * 1e6) / 1e6); set("lon", Math.round(lon * 1e6) / 1e6);
    let best: { name: string; d: number } | undefined;
    for (const z of zones) { const d = haversine({ lat, lon }, z); if (!best || d < best.d) best = { name: z.name, d }; }
    if (best && best.d < 6000) set("zone", best.name);
  }

  const valid = [
    !!f.deviceType,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/.test(f.deviceId) && !f.deviceId.endsWith("-"),
    f.lat !== undefined && !!f.zone && (!!f.siteId || f.siteName.length >= 2),
    !!f.department,
    !!f.protocol,
    true,
  ];

  async function save() {
    setBusy(true); setErr(undefined);
    try {
      const body = {
        deviceId: f.deviceId, name: f.name || undefined, deviceType: f.deviceType, serial: f.serial || undefined, vendor: f.vendor || undefined, model: f.model || undefined,
        firmware: f.firmware || undefined, protocol: f.protocol, zone: f.zone || undefined, siteId: f.siteId || undefined, siteName: f.siteId ? undefined : f.siteName || undefined,
        assetId: f.assetId || undefined, assetName: f.assetId ? undefined : f.assetName || undefined, assetKind: f.assetKind || undefined, department: f.department || undefined,
        criticality: f.criticality, lat: f.lat, lon: f.lon, profileId: f.profileId || undefined, installedAt: f.installedAt || undefined, notes: f.notes || undefined,
      };
      const d = existing ? await apiSend<any>("PUT", `/assets/devices/${encodeURIComponent(f.deviceId)}`, body) : await apiSend<any>("POST", "/assets/devices", body);
      setSaved(d);
      if (["mqtt", "http"].includes(f.protocol) && !(existing?.tbDeviceId)) {
        try { setCreds(await apiSend<any>("POST", `/assets/devices/${encodeURIComponent(f.deviceId)}/provision`)); }
        catch (e) { setErr(`Registered, but ThingsBoard provisioning failed: ${(e as Error).message}. You can retry from the device drawer.`); }
      } else if (f.protocol === "http-ingest") {
        setCreds({ connection: await apiGet<any>(`/assets/devices/${encodeURIComponent(f.deviceId)}/connection`).catch(() => undefined) });
      }
      setStep(5);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Page title={existing ? `Map device ${existing.deviceId}` : "Onboard a device"} subtitle={existing?.status === "Discovered" ? "This device is already sending data. Confirm its type and tell the city where it is and who owns it." : "Register, place, assign and connect a new device in six steps."}
      actions={<button className="btn" onClick={() => nav("/assets")}><Icon name="X" size={15} /> Cancel</button>}>
      <div className="card">
        <Stepper steps={STEPS} current={step} />

        {step === 0 && (
          <div className="choice-grid">
            {(catalog ?? []).map((c) => {
              const m = domainOf(c.domain);
              return (
                <div key={c.name} className={`choice${f.deviceType === c.name ? " on" : ""}`} onClick={() => set("deviceType", c.name)}>
                  <Icon name={m.icon} size={22} color={m.color} />
                  <div><b>{c.name}</b><div className="hint">{c.description}</div><div className="hint" style={{ marginTop: 4 }}>{c.telemetry.slice(0, 4).join(", ")}{c.telemetry.length > 4 ? "…" : ""}</div></div>
                </div>
              );
            })}
          </div>
        )}

        {step === 1 && (
          <div className="grid cols-2" style={{ gap: 14 }}>
            <label className="field">Device ID (unique in this city)<input value={f.deviceId} disabled={!!existing} onChange={(e) => set("deviceId", e.target.value.trim())} placeholder={`${type?.prefix ?? "XX"}-ZONE-001`} /></label>
            <label className="field">Display name<input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. CP inner circle lamp 101" /></label>
            <label className="field">Serial number<input value={f.serial} onChange={(e) => set("serial", e.target.value)} /></label>
            <label className="field">Vendor<input value={f.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. Signify" /></label>
            <label className="field">Model<input value={f.model} onChange={(e) => set("model", e.target.value)} /></label>
            <label className="field">Firmware<input value={f.firmware} onChange={(e) => set("firmware", e.target.value)} /></label>
            {existing?.events?.find((e: any) => e.data?.keys) && <div className="banner" style={{ gridColumn: "1 / -1" }}><Icon name="Info" size={15} /> Keys seen from this device: {existing.events.find((e: any) => e.data?.keys).data.keys.join(", ")}. If they are vendor names, pick a mapping profile in step 5.</div>}
          </div>
        )}

        {step === 2 && (
          <div className="grid main-side">
            <div>
              <div className="hint" style={{ marginBottom: 8 }}><Icon name="MapPin" size={13} /> Click the map where the device is installed. The nearest zone is suggested.</div>
              <CityMap center={f.lat ? { lat: f.lat, lon: f.lon } : me?.city?.center ?? tenant?.center ?? { lat: 28.6139, lon: 77.209 }} height={420} showLegend={false} live={false}
                incidents={f.lat ? [{ id: "pin", title: f.deviceId, severity: "Low", lat: f.lat, lon: f.lon }] : []} onPick={pick} />
            </div>
            <div className="stack" style={{ gap: 12 }}>
              <div className="grid cols-2" style={{ gap: 10 }}>
                <label className="field">Latitude<input value={f.lat ?? ""} onChange={(e) => set("lat", e.target.value === "" ? undefined : Number(e.target.value))} /></label>
                <label className="field">Longitude<input value={f.lon ?? ""} onChange={(e) => set("lon", e.target.value === "" ? undefined : Number(e.target.value))} /></label>
              </div>
              <label className="field">Zone<select value={f.zone} onChange={(e) => { set("zone", e.target.value); set("siteId", ""); set("assetId", ""); }}><option value="">Choose…</option>{zones.map((z) => <option key={z.name}>{z.name}</option>)}</select></label>
              <label className="field">Site
                <select value={f.siteId} onChange={(e) => { set("siteId", e.target.value); set("assetId", ""); }}>
                  <option value="">+ New site…</option>{(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.kind})</option>)}
                </select>
              </label>
              {!f.siteId && <label className="field">New site name<input value={f.siteName} onChange={(e) => set("siteName", e.target.value)} placeholder={`${f.zone || "Zone"} ${type?.domain === "traffic" ? "Junction 03" : "Street Grid"}`} /></label>}
              <label className="field">Physical asset
                <select value={f.assetId} onChange={(e) => set("assetId", e.target.value)}><option value="">+ New asset…</option>{(siteAssets ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </label>
              {!f.assetId && <div className="grid cols-2" style={{ gap: 10 }}>
                <label className="field">New asset name<input value={f.assetName} onChange={(e) => set("assetName", e.target.value)} placeholder={`Pole ${f.deviceId}`} /></label>
                <label className="field">Asset kind<input value={f.assetKind} onChange={(e) => set("assetKind", e.target.value)} placeholder="pole, pump, feeder, bin…" /></label>
              </div>}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid cols-2" style={{ gap: 14 }}>
            <label className="field">Owning department (routes incidents and work orders)<select value={f.department} onChange={(e) => set("department", e.target.value)}><option value="">Choose…</option>{(depts ?? []).map((d) => <option key={d.id} value={d.name}>{d.name}{d.categories?.includes(type?.domain) ? " (suggested)" : ""}</option>)}</select></label>
            <label className="field">Criticality<select value={f.criticality} onChange={(e) => set("criticality", e.target.value)}>{["Critical", "High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">Installed on<input type="date" value={f.installedAt} onChange={(e) => set("installedAt", e.target.value)} /></label>
            <label className="field">Maintenance team / notes<input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="e.g. KB depot crew B, AMC with Signify until 2028" /></label>
          </div>
        )}

        {step === 4 && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="choice-grid">
              {PROTOCOLS.map(([id, label, help]) => (
                <div key={id} className={`choice${f.protocol === id ? " on" : ""}`} onClick={() => set("protocol", id)}>
                  <Icon name={id.startsWith("http") ? "Send" : id === "mqtt" ? "Radio" : id === "kafka" ? "Workflow" : "Link"} size={20} color="#4f46e5" />
                  <div><b>{label}</b><div className="hint">{help}</div></div>
                </div>
              ))}
            </div>
            <label className="field" style={{ maxWidth: 420 }}>Mapping profile (vendor keys → canonical keys)
              <select value={f.profileId} onChange={(e) => set("profileId", e.target.value)}><option value="">None: device sends canonical keys</option>{(profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.vendor ? ` · ${p.vendor}` : ""}</option>)}</select>
            </label>
            <Summary f={f} sites={sites} />
          </div>
        )}

        {step === 5 && <Verify deviceId={f.deviceId} creds={creds} saved={saved} onDone={() => nav("/assets#registry")} />}

        <ErrorNote msg={err} />
        {step < 5 && (
          <div className="row mt" style={{ justifyContent: "space-between" }}>
            <button className="btn" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
            {step < 4 ? <button className="btn primary" disabled={!valid[step]} onClick={() => setStep((s) => s + 1)}>Next <Icon name="ArrowRight" size={15} /></button>
              : <button className="btn primary" disabled={busy || !valid.slice(0, 5).every(Boolean)} onClick={save}>{existing ? "Save mapping" : "Register device"}{["mqtt", "http"].includes(f.protocol) && !existing?.tbDeviceId ? " & provision" : ""}</button>}
          </div>
        )}
      </div>
    </Page>
  );
}

function Summary({ f, sites }: { f: any; sites?: any[] }) {
  const site = f.siteId ? sites?.find((s) => s.id === f.siteId)?.name : f.siteName;
  return (
    <div className="card" style={{ padding: 14 }}>
      <b>Review</b>
      <div className="chain mt" style={{ marginTop: 8 }}>{[f.zone, site, f.assetId ? "existing asset" : f.assetName || `Asset ${f.deviceId}`, f.deviceId].map((x, n, a) => <span key={n} className="row" style={{ gap: 6 }}><b>{x || "—"}</b>{n < a.length - 1 && <span className="sep">›</span>}</span>)}</div>
      <div className="hint" style={{ marginTop: 6 }}>{f.deviceType} · {f.department} · {f.criticality} · {PROTOCOL_LABEL[f.protocol]}</div>
    </div>
  );
}

/** Step 6: wait for the first message, then commission (Active). */
function Verify({ deviceId, creds, saved, onDone }: { deviceId: string; creds?: any; saved?: any; onDone: () => void }) {
  const { data: d, reload } = useApi<any>(`/assets/devices/${encodeURIComponent(deviceId)}`, 3000);
  const { data: twin } = useApi<any>(`/twin/devices/${encodeURIComponent(deviceId)}`, 5000);
  const [msg, setMsg] = useState<string>();
  const seen = !!(d?.lastSeen || twin?.state?.ts);
  const values = twin?.state?.values ?? {};
  const active = d?.status === "Active";
  async function commission() {
    try { await apiSend("POST", `/assets/devices/${encodeURIComponent(deviceId)}/transition`, { action: "commission" }); await reload(); setMsg(undefined); }
    catch (e) { setMsg((e as Error).message); }
  }
  const status = useMemo(() => active ? "done" : seen ? "seen" : "waiting", [active, seen]);
  return (
    <div className="grid main-side">
      <div className="stack">
        <div className="banner" style={{ marginBottom: 0 }}><Icon name="Check" size={16} color="#16a34a" /> {saved ? `Device ${deviceId} saved as ${saved.status}.` : "Saved."} Configure the device with the details below, then power it on.</div>
        {creds?.token ? <Credentials r={creds} /> : creds?.connection?.ingest ? <div className="card" style={{ padding: 12 }}><b>Send data through the ingest API</b><div className="code mt">{creds.connection.ingest.curl}</div><div className="hint">Create a city API key in City setup → API keys if you do not have one.</div></div> : null}
      </div>
      <div className="card">
        <h3><Icon name="Activity" size={16} /> First telemetry</h3>
        {status === "waiting" && <div className="row"><span className="live"><i /> Listening</span><span className="hint">No message yet from {deviceId}. This page checks every 3 seconds.</span></div>}
        {status !== "waiting" && (
          <>
            <div className="badge green">Data received {timeAgo(d?.lastSeen ?? twin?.state?.ts)}</div>
            <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>{Object.entries(values).slice(0, 8).map(([k, v]) => <span key={k} className="badge blue">{k}: {String(typeof v === "number" ? Math.round(v * 100) / 100 : v)}</span>)}</div>
          </>
        )}
        <div className="row mt" style={{ flexWrap: "wrap" }}>
          <span className="hint">Status</span><DeviceStatusBadge s={d?.status} />
        </div>
        <div className="row mt" style={{ flexWrap: "wrap" }}>
          {!active && <button className={`btn${seen ? " primary" : ""}`} onClick={commission}>{seen ? "Commission device" : "Commission without waiting"}</button>}
          {active && <div className="badge green">Active. Alarms from this device now open incidents for its department.</div>}
          <button className="btn" onClick={onDone}>Finish</button>
        </div>
        {msg && <div className="badge red" style={{ marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  );
}
