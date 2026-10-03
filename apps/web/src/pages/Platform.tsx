import { useState } from "react";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { StatusBadge } from "../components/Badges";
import { Bar } from "../components/Charts";
import { Tabs, useTab, Kpi, Modal, Stepper, ErrorNote } from "../components/Ui";
import { Catalog } from "./Assets";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { apiSend } from "../lib/api";
import { compact, fmt, timeAgo } from "../lib/format";

const MODULE_ICON: Record<string, string> = { command_centre: "Siren", digital_twin: "Layers", sla_workorders: "ClipboardList", citizen_portal: "Megaphone", analytics: "BarChart3", integrations: "Link" };

/** Platform Super Admin console: govern the SaaS, not a city. Cities, plans and quotas, entitlements, catalogue, announcements, health. */
export function Platform() {
  const [tab, setTab] = useTab("overview", ["overview", "cities", "plans", "catalog", "announcements", "audit"]);
  const { data: usage, reload } = useApi<any>("/platform/usage", 15_000);
  const [wizard, setWizard] = useState(false);
  const [city, setCity] = useState<string>();
  return (
    <Page title="Platform console" subtitle="Every city on CitySphere: onboarding, plans, entitlements and platform health."
      actions={<button className="btn primary" onClick={() => setWizard(true)}><Icon name="Plus" size={16} /> Onboard a city</button>}>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "overview", label: "Overview", icon: "LayoutGrid" }, { id: "cities", label: "Cities", icon: "Building2", count: usage?.totals?.cities },
        { id: "plans", label: "Plans & modules", icon: "Package" }, { id: "catalog", label: "Device catalogue", icon: "Cpu" },
        { id: "announcements", label: "Announcements", icon: "Megaphone" }, { id: "audit", label: "Audit", icon: "Shield" },
      ]} />
      {tab === "overview" && <Overview usage={usage} onOpen={setCity} />}
      {tab === "cities" && <Cities usage={usage} onOpen={setCity} />}
      {tab === "plans" && <Plans />}
      {tab === "catalog" && <Catalog />}
      {tab === "announcements" && <Announcements cities={usage?.cities ?? []} />}
      {tab === "audit" && <Audit />}
      {wizard && <CityWizard onClose={() => setWizard(false)} onCreated={(id) => { setWizard(false); void reload(); setCity(id); }} />}
      {city && <CityDrawer id={city} usage={usage?.cities?.find((c: any) => c.id === city)} onClose={() => setCity(undefined)} onChanged={reload} />}
    </Page>
  );
}

function Overview({ usage, onOpen }: { usage?: any; onOpen: (id: string) => void }) {
  const t = usage?.totals ?? {};
  const cities: any[] = usage?.cities ?? [];
  const alerts = [
    ...cities.filter((c) => c.status === "failed").map((c) => ({ id: c.id, tone: "red", text: `${c.cityName}: provisioning failed${c.error ? ` (${c.error.slice(0, 80)})` : ""}` })),
    ...cities.filter((c) => c.status === "suspended").map((c) => ({ id: c.id, tone: "amber", text: `${c.cityName} is suspended: logins and API keys are blocked` })),
    ...cities.filter((c) => c.deviceQuotaPct >= 80).map((c) => ({ id: c.id, tone: "amber", text: `${c.cityName} uses ${c.deviceQuotaPct}% of its device quota` })),
    ...cities.filter((c) => c.discoveredDevices > 0).map((c) => ({ id: c.id, tone: "blue", text: `${c.cityName} has ${c.discoveredDevices} unmapped devices sending data` })),
    ...cities.filter((c) => c.criticalIncidents > 0).map((c) => ({ id: c.id, tone: "red", text: `${c.cityName}: ${c.criticalIncidents} critical incidents open` })),
  ];
  return (
    <>
      <div className="grid cols-6k">
        <Kpi label="Cities" icon="Building2" value={fmt(t.cities)} sub={`${t.active ?? 0} active · ${t.suspended ?? 0} suspended`} />
        <Kpi label="Citizens served" icon="Users" value={compact(t.population ?? 0)} />
        <Kpi label="Devices" icon="Cpu" value={fmt(t.devices)} sub={`${fmt(t.activeDevices)} active`} />
        <Kpi label="Open incidents" icon="AlertTriangle" value={fmt(t.openIncidents)} />
        <Kpi label="Incidents, 24 h" icon="Activity" value={fmt(t.incidents24h)} />
        <Kpi label="Needs attention" icon="Flag" value={alerts.length} tone={alerts.length ? "#ea580c" : "#16a34a"} />
      </div>
      <div className="grid main-side mt">
        <div className="card">
          <CityMap title="Cities on the platform" live={false} zoom={4} center={{ lat: 21.5, lon: 79 }} showLegend={false} height={460}
            incidents={cities.map((c) => ({ id: c.id, title: `${c.cityName} · ${c.openIncidents} open`, severity: c.status === "suspended" ? "Medium" : c.criticalIncidents ? "Critical" : "Low", lat: c.center?.lat, lon: c.center?.lon }))}
            onSelectIncident={onOpen} />
        </div>
        <div className="stack">
          <div className="card">
            <h3><Icon name="Flag" size={16} /> Attention</h3>
            {alerts.map((a, n) => <div key={n} className="alert-item" onClick={() => onOpen(a.id)}><span className={`badge ${a.tone}`}>!</span><div className="t"><b>{a.text}</b></div></div>)}
            {!alerts.length && <div className="empty">All cities healthy</div>}
          </div>
          <div className="card">
            <h3>Device quota use</h3>
            {cities.map((c) => <div key={c.id} style={{ marginBottom: 10 }}><div className="row between" style={{ fontSize: 13 }}><span>{c.cityName}</span><span className="hint">{fmt(c.devices)} / {fmt(c.quotas?.devices)}</span></div><Bar pct={c.deviceQuotaPct} color={c.deviceQuotaPct >= 80 ? "#f97316" : "#4f46e5"} /></div>)}
          </div>
        </div>
      </div>
    </>
  );
}

function Cities({ usage, onOpen }: { usage?: any; onOpen: (id: string) => void }) {
  const { switchTenant } = useAuth();
  return (
    <div className="card" style={{ overflow: "auto" }}>
      <table className="tbl"><thead><tr><th>City</th><th>Plan</th><th>Modules</th><th>Devices / quota</th><th>Open incidents</th><th>Zones</th><th>Status</th><th>Since</th><th></th></tr></thead><tbody>
        {(usage?.cities ?? []).map((c: any) => (
          <tr key={c.id} className="click" onClick={() => onOpen(c.id)}>
            <td><b>{c.cityName}</b><div className="hint">{c.name} · <span className="mono">{c.id}</span></div></td>
            <td style={{ textTransform: "capitalize" }}>{c.plan}</td>
            <td><div className="row" style={{ gap: 4 }}>{(c.modules ?? []).map((m: string) => <span key={m} title={m}><Icon name={MODULE_ICON[m] ?? "Box"} size={15} color="#4f46e5" /></span>)}</div></td>
            <td style={{ minWidth: 140 }}>{fmt(c.devices)} / {fmt(c.quotas?.devices)}<Bar pct={c.deviceQuotaPct} color={c.deviceQuotaPct >= 80 ? "#f97316" : "#4f46e5"} /></td>
            <td>{c.openIncidents}{c.criticalIncidents ? <span className="badge red" style={{ marginLeft: 6 }}>{c.criticalIncidents} critical</span> : null}</td>
            <td>{c.zones}</td><td><StatusBadge s={c.status} /></td><td>{timeAgo(c.createdAt)}</td>
            <td><button className="btn sm" onClick={(e) => { e.stopPropagation(); switchTenant(c.id); }}>Open as city</button></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function CityDrawer({ id, usage, onClose, onChanged }: { id: string; usage?: any; onClose: () => void; onChanged: () => void }) {
  const { switchTenant } = useAuth();
  const { data: t, reload, setData } = useApi<any>(`/tenants/${id}`, 4000);
  const { data: plans } = useApi<any>("/plans");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [quota, setQuota] = useState<Record<string, string>>({});
  async function patch(body: any, text: string) {
    setMsg(undefined);
    try { const r = await apiSend<any>("PUT", `/tenants/${id}`, body); setData(r); await reload(); onChanged(); setMsg({ ok: true, text }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }
  const planDef = plans?.plans?.[t?.plan ?? "standard"];
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="City">
        <div className="row between"><span className="mono hint">{id}</span><button className="btn sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></button></div>
        {!t ? <div className="empty">Loading…</div> : (
          <>
            <h2 style={{ marginTop: 8 }}>{t.cityName}</h2>
            <div className="row"><StatusBadge s={t.status} /><span className="hint">{t.name}</span></div>
            <div className="grid cols-3 mt" style={{ gap: 10 }}>
              <div className="card" style={{ padding: 12 }}><div className="hint">Devices</div><b>{fmt(usage?.devices)}</b></div>
              <div className="card" style={{ padding: 12 }}><div className="hint">Open incidents</div><b>{fmt(usage?.openIncidents)}</b></div>
              <div className="card" style={{ padding: 12 }}><div className="hint">Population</div><b>{compact(t.population ?? 0)}</b></div>
            </div>
            <div className="row mt" style={{ flexWrap: "wrap" }}>
              <button className="btn sm" onClick={() => switchTenant(id)}><Icon name="Eye" size={14} /> Open as city</button>
              {t.status === "suspended" ? <button className="btn sm primary" onClick={() => patch({ status: "active" }, "City resumed")}><Icon name="Play" size={14} /> Resume</button>
                : t.status === "active" && <button className="btn sm danger" onClick={() => patch({ status: "suspended" }, "City suspended: logins and API keys blocked")}><Icon name="Pause" size={14} /> Suspend</button>}
              {["failed", "active"].includes(t.status) && <button className="btn sm" onClick={async () => { await apiSend("POST", `/tenants/${id}/provision`); await reload(); }}><Icon name="RefreshCw" size={14} /> Re-provision</button>}
            </div>
            {msg && <div className={`badge ${msg.ok ? "green" : "red"}`} style={{ marginTop: 8, display: "inline-block" }}>{msg.text}</div>}

            <h3 className="mt" style={{ fontSize: 14 }}>Plan</h3>
            <div className="seg">{Object.entries(plans?.plans ?? {}).map(([k, p]: [string, any]) => <button key={k} className={t.plan === k ? "on" : ""} onClick={() => patch({ plan: k }, `Plan changed to ${p.name}`)}>{p.name}</button>)}</div>
            <h3 className="mt" style={{ fontSize: 14 }}>Modules</h3>
            {(plans?.modules ?? []).map((m: any) => {
              const inPlan = planDef?.modules?.includes(m.id);
              const on = t.modules?.includes(m.id);
              return (
                <label key={m.id} className="row" style={{ padding: "6px 0", fontSize: 13, opacity: inPlan ? 1 : 0.5 }}>
                  <input type="checkbox" disabled={!inPlan} checked={!!on} onChange={(e) => patch({ modules: e.target.checked ? [...t.modules, m.id] : t.modules.filter((x: string) => x !== m.id) }, `${m.name} ${e.target.checked ? "enabled" : "disabled"}`)} />
                  <Icon name={MODULE_ICON[m.id] ?? "Box"} size={15} /> {m.name}{!inPlan && <span className="hint">(not in plan)</span>}
                </label>
              );
            })}
            <h3 className="mt" style={{ fontSize: 14 }}>Quotas <span className="hint">(blank = plan default)</span></h3>
            <div className="grid cols-2" style={{ gap: 10 }}>
              {[["devices", "Devices"], ["users", "Users"], ["apiCallsPerDay", "API calls / day"], ["retentionDays", "Retention (days)"]].map(([k, l]) => (
                <label key={k} className="field">{l} <span className="hint">effective {fmt(t.effectiveQuotas?.[k])}</span><input value={quota[k] ?? t.quotas?.[k] ?? ""} placeholder={String(planDef?.quotas?.[k] ?? "")} onChange={(e) => setQuota({ ...quota, [k]: e.target.value })} /></label>
              ))}
            </div>
            <button className="btn sm mt" onClick={() => patch({ quotas: Object.fromEntries(Object.entries({ ...t.quotas, ...quota }).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => [k, Number(v)])) }, "Quotas saved")}>Save quotas</button>

            <h3 className="mt" style={{ fontSize: 14 }}>Provisioning log</h3>
            <div className="timeline">{(t.provisionLog ?? []).map((l: any, n: number) => <div key={n} className="ev"><b className="row" style={{ gap: 6 }}><Icon name={l.ok ? "Check" : "X"} size={13} color={l.ok ? "#16a34a" : "#dc2626"} />{l.step}</b><span>{new Date(l.at).toLocaleString()}</span></div>)}</div>
            <h3 className="mt" style={{ fontSize: 14 }}>Zones</h3>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{(t.zones ?? []).map((z: any) => <span key={z.name} className="badge blue">{z.name}</span>)}</div>
          </>
        )}
      </aside>
    </>
  );
}

/** 5-step city onboarding: authority -> map and zones -> plan and modules -> first City Admin -> review and provision. */
function CityWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { data: plans } = useApi<any>("/plans");
  const [step, setStep] = useState(0);
  const [f, setF] = useState<any>({ id: "", name: "", cityName: "", population: "", contactName: "", contactEmail: "", center: undefined, zones: [] as any[], zoneName: "", plan: "standard", modules: undefined, adminUsername: "", adminEmail: "", adminFirst: "", adminLast: "" });
  const [err, setErr] = useState<string>();
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const planDef = plans?.plans?.[f.plan];
  const modules: string[] = f.modules ?? planDef?.modules ?? [];
  const steps = ["Authority & city", "Map & zones", "Plan & modules", "First City Admin", "Review & provision"];
  const valid = [/^[a-z][a-z0-9-]{1,30}$/.test(f.id) && f.name.length > 2 && f.cityName.length > 1, !!f.center, !!f.plan && modules.length > 0, !f.adminUsername || /^[a-z0-9._-]{3,40}$/.test(f.adminUsername), true];
  async function create() {
    setErr(undefined);
    try {
      await apiSend("POST", "/tenants", {
        id: f.id, name: f.name, cityName: f.cityName, center: f.center, zones: f.zones, plan: f.plan, modules,
        population: f.population ? Number(f.population) : undefined, contact: { name: f.contactName || undefined, email: f.contactEmail || undefined },
        adminUser: f.adminUsername ? { username: f.adminUsername, email: f.adminEmail || undefined, firstName: f.adminFirst || undefined, lastName: f.adminLast || undefined } : undefined,
      });
      onCreated(f.id);
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <Modal wide title="Onboard a city" onClose={onClose} footer={<>
      <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
      {step < 4 ? <button className="btn primary" disabled={!valid[step]} onClick={() => setStep(step + 1)}>Next</button> : <button className="btn primary" onClick={create}><Icon name="Play" size={15} /> Create and provision</button>}
    </>}>
      <Stepper steps={steps} current={step} />
      {step === 0 && (
        <div className="grid cols-2" style={{ gap: 12 }}>
          <label className="field">City ID (lowercase, used in URLs and Keycloak)<input value={f.id} onChange={(e) => set("id", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="pune" /></label>
          <label className="field">City name<input value={f.cityName} onChange={(e) => set("cityName", e.target.value)} placeholder="Pune" /></label>
          <label className="field">Authority<input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Pune Municipal Corporation" /></label>
          <label className="field">Population<input value={f.population} onChange={(e) => set("population", e.target.value.replace(/\D/g, ""))} placeholder="3100000" /></label>
          <label className="field">Contact person<input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} /></label>
          <label className="field">Contact email<input value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} /></label>
        </div>
      )}
      {step === 1 && (
        <div className="grid main-side">
          <div>
            <div className="hint" style={{ marginBottom: 6 }}>Click once to set the city centre, then type a zone name and click to drop each zone.</div>
            <CityMap zoom={f.center ? 11 : 4} center={f.center ?? { lat: 21.5, lon: 79 }} height={380} showLegend={false} live={false}
              incidents={[...(f.center ? [{ id: "c", title: "City centre", severity: "Critical", lat: f.center.lat, lon: f.center.lon }] : []), ...f.zones.map((z: any, n: number) => ({ id: `z${n}`, title: z.name, severity: "Low", lat: z.lat, lon: z.lon }))]}
              onPick={(lat, lon) => { const p = { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 }; if (!f.center) set("center", p); else if (f.zoneName.trim()) { set("zones", [...f.zones, { name: f.zoneName.trim(), ...p }]); set("zoneName", ""); } }} />
          </div>
          <div className="stack" style={{ gap: 10 }}>
            <div className="hint">Centre: {f.center ? `${f.center.lat}, ${f.center.lon}` : "not set"} {f.center && <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => set("center", undefined)}>reset</a>}</div>
            <label className="field">Next zone name<input value={f.zoneName} onChange={(e) => set("zoneName", e.target.value)} placeholder="e.g. Shivajinagar" /></label>
            {f.zones.map((z: any, n: number) => <div key={n} className="row between"><span>{z.name} <span className="hint">{z.lat}, {z.lon}</span></span><button className="btn sm" onClick={() => set("zones", f.zones.filter((_: any, i: number) => i !== n))}><Icon name="X" size={12} /></button></div>)}
            <div className="hint">Zones become ThingsBoard zone assets and the top of the device hierarchy. You can add more later in City setup.</div>
          </div>
        </div>
      )}
      {step === 2 && (
        <>
          <div className="grid cols-3" style={{ gap: 12 }}>
            {Object.entries(plans?.plans ?? {}).map(([k, p]: [string, any]) => (
              <div key={k} className={`choice${f.plan === k ? " on" : ""}`} onClick={() => { set("plan", k); set("modules", undefined); }}>
                <Icon name="Package" size={20} color="#4f46e5" />
                <div><b>{p.name}</b><div className="hint">{p.priceNote}</div><div className="hint" style={{ marginTop: 4 }}>{fmt(p.quotas.devices)} devices · {fmt(p.quotas.users)} users · {p.quotas.retentionDays} d retention</div></div>
              </div>
            ))}
          </div>
          <h3 className="mt" style={{ fontSize: 14 }}>Modules</h3>
          {(plans?.modules ?? []).map((m: any) => {
            const inPlan = planDef?.modules?.includes(m.id);
            return <label key={m.id} className="row" style={{ padding: "4px 0", fontSize: 13, opacity: inPlan ? 1 : 0.45 }}><input type="checkbox" disabled={!inPlan} checked={modules.includes(m.id)} onChange={(e) => set("modules", e.target.checked ? [...modules, m.id] : modules.filter((x) => x !== m.id))} /><Icon name={MODULE_ICON[m.id] ?? "Box"} size={15} /> {m.name}</label>;
          })}
        </>
      )}
      {step === 3 && (
        <div className="grid cols-2" style={{ gap: 12 }}>
          <label className="field">Username<input value={f.adminUsername} onChange={(e) => set("adminUsername", e.target.value.toLowerCase())} placeholder={`admin.${f.id || "city"}`} /></label>
          <label className="field">Email<input value={f.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} /></label>
          <label className="field">First name<input value={f.adminFirst} onChange={(e) => set("adminFirst", e.target.value)} /></label>
          <label className="field">Last name<input value={f.adminLast} onChange={(e) => set("adminLast", e.target.value)} /></label>
          <div className="hint" style={{ gridColumn: "1 / -1" }}>Created in Keycloak with the City Admin role in group /tenants/{f.id || "<city>"} and a temporary password (Welcome@123) that must be changed at first login. Leave blank to add later.</div>
        </div>
      )}
      {step === 4 && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="card" style={{ padding: 14 }}>
            <b>{f.cityName}</b> <span className="hint">({f.id}) · {f.name}</span>
            <div className="hint" style={{ marginTop: 6 }}>Plan {planDef?.name} · modules {modules.length} · {f.zones.length} zones · admin {f.adminUsername || "none yet"}</div>
          </div>
          <div className="hint">Provisioning will: create the ThingsBoard tenant and tenant admin, install 14 device profiles with alarm rules, create zone assets, patch the root rule chain to export telemetry and alarms to Kafka, create the Keycloak group, and seed a city API key. You can watch each step in the city drawer.</div>
          <ErrorNote msg={err} />
        </div>
      )}
    </Modal>
  );
}

function Plans() {
  const { data } = useApi<any>("/plans");
  return (
    <div className="grid cols-3">
      {Object.entries(data?.plans ?? {}).map(([k, p]: [string, any]) => (
        <div key={k} className="card">
          <h3><Icon name="Package" size={18} /> {p.name}</h3>
          <div className="hint">{p.priceNote}</div>
          <dl className="kv"><dt>Devices</dt><dd>{fmt(p.quotas.devices)}</dd><dt>Users</dt><dd>{fmt(p.quotas.users)}</dd><dt>API calls / day</dt><dd>{compact(p.quotas.apiCallsPerDay)}</dd><dt>Data retention</dt><dd>{p.quotas.retentionDays} days</dd></dl>
          {(data?.modules ?? []).map((m: any) => <div key={m.id} className="row" style={{ fontSize: 13, padding: "3px 0" }}><Icon name={p.modules.includes(m.id) ? "Check" : "Minus"} size={14} color={p.modules.includes(m.id) ? "#16a34a" : "#cbd5e1"} />{m.name}</div>)}
        </div>
      ))}
    </div>
  );
}

function Announcements({ cities }: { cities: any[] }) {
  const { data, reload } = useApi<any[]>("/announcements?all=true");
  const [f, setF] = useState({ tenantId: "", title: "", body: "", level: "info", hours: "24" });
  async function save() { await apiSend("POST", "/announcements", { ...f, body: f.body || undefined, hours: Number(f.hours) || undefined }); setF({ ...f, title: "", body: "" }); await reload(); }
  return (
    <div className="grid main-side">
      <div className="card">
        <h3><Icon name="Megaphone" size={16} /> Announcements</h3>
        {(data ?? []).map((a) => (
          <div key={a.id} className="alert-item">
            <span className={`badge ${a.level === "critical" ? "red" : a.level === "warning" ? "amber" : "blue"}`}>{a.level}</span>
            <div className="t"><b>{a.title}</b><span>{a.tenantId === "*" ? "All cities" : a.tenantId} · {timeAgo(a.startsAt)}{a.endsAt ? ` · ends ${new Date(a.endsAt).toLocaleString()}` : ""}</span></div>
            <button className="btn sm" onClick={async () => { await apiSend("DELETE", `/announcements/${a.id}`); await reload(); }}>End</button>
          </div>
        ))}
        {!data?.length && <div className="empty">No announcements</div>}
      </div>
      <div className="card">
        <h3>New announcement</h3>
        <div className="stack" style={{ gap: 10 }}>
          <label className="field">Audience<select value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })}><option value="">All cities</option>{cities.map((c) => <option key={c.id} value={c.id}>{c.cityName}</option>)}</select></label>
          <label className="field">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label className="field">Message<textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <label className="field">Level<select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
            <label className="field">Show for (hours)<input value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></label>
          </div>
          <button className="btn primary" disabled={f.title.length < 3} onClick={save}>Publish banner</button>
        </div>
      </div>
    </div>
  );
}

function Audit() {
  const { data } = useApi<any[]>("/audit?limit=100", 30_000);
  return (
    <div className="card">
      <h3><Icon name="Shield" size={16} /> Audit trail <span className="hint" style={{ marginLeft: 8 }}>append-only; city in view</span></h3>
      <div style={{ maxHeight: 560, overflow: "auto" }}>
        <table className="tbl"><thead><tr><th>When</th><th>City</th><th>Actor</th><th>Action</th><th>Resource</th></tr></thead><tbody>
          {(data ?? []).map((a, n) => <tr key={n}><td>{timeAgo(a.at)}</td><td>{a.tenant_id}</td><td>{a.actor}</td><td>{a.action}</td><td className="mono">{a.resource}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}
