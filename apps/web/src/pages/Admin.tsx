import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Page } from "../components/Layout";
import { CityMap } from "../components/CityMap";
import { Icon } from "../components/Icon";
import { Tabs, useTab, Modal, ErrorNote } from "../components/Ui";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { apiSend } from "../lib/api";
import { DOMAINS, timeAgo } from "../lib/format";
import { PERSONA_META, type Persona } from "../lib/personas";

const CATEGORIES = ["traffic", "parking", "water", "electricity", "lighting", "environment", "waste", "mobility", "emergency", "weather", "events"];
const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const EVENTS = ["incident.created", "incident.escalated", "sla.amber", "sla.breached", "workorder.assigned", "advisory.published", "manual", "*"];
const CITY_ROLES: Persona[] = ["city_admin", "leadership", "operator", "dept_head", "field_tech", "analyst", "it_ops", "citizen"];

/** City Admin: everything a city needs configured, with a setup checklist. */
export function Admin() {
  const [tab, setTab] = useTab("setup", ["setup", "zones", "departments", "users", "sla", "notifications", "keys"]);
  return (
    <Page title="City setup" subtitle="Zones, departments, people, service levels, notifications and integrations for this city.">
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "setup", label: "Setup checklist", icon: "ListChecks" }, { id: "zones", label: "Zones", icon: "Map" }, { id: "departments", label: "Departments", icon: "Building" },
        { id: "users", label: "Users & roles", icon: "Users" }, { id: "sla", label: "SLA matrix", icon: "Clock" }, { id: "notifications", label: "Notifications", icon: "Bell" },
        { id: "keys", label: "API keys & integrations", icon: "KeyRound" },
      ]} />
      {tab === "setup" && <Setup go={setTab} />}
      {tab === "zones" && <Zones />}
      {tab === "departments" && <Departments />}
      {tab === "users" && <Users />}
      {tab === "sla" && <SlaMatrix />}
      {tab === "notifications" && <Notifications />}
      {tab === "keys" && <Keys />}
    </Page>
  );
}

function Setup({ go }: { go: (t: string) => void }) {
  const { me } = useAuth();
  const nav = useNavigate();
  const { data: tenant } = useApi<any>(me ? `/tenants/${me.tenantId}` : null);
  const { data: depts } = useApi<any[]>("/departments");
  const { data: users } = useApi<any[]>("/users");
  const { data: assets } = useApi<any>("/assets/summary");
  const { data: sla } = useApi<any>("/sla/policies");
  const { data: channels } = useApi<any[]>("/notifications/channels");
  const { data: keys } = useApi<any[]>(me ? `/tenants/${me.tenantId}/api-keys` : null);
  const items: Array<[boolean, string, string, () => void]> = [
    [tenant?.status === "active", "City provisioned on ThingsBoard", tenant?.status ? `Status: ${tenant.status}` : "…", () => undefined],
    [(tenant?.zones ?? []).length > 0, "Zones defined", `${(tenant?.zones ?? []).length} zones`, () => go("zones")],
    [(depts ?? []).length > 0 && (depts ?? []).every((d) => d.categories?.length), "Departments own every category", `${(depts ?? []).length} departments`, () => go("departments")],
    [(users ?? []).filter((u) => u.roles?.includes("operator")).length > 0, "Command centre operators invited", `${(users ?? []).length} users`, () => go("users")],
    [(sla?.overrides ?? []).length > 0, "SLA matrix reviewed", `${(sla?.overrides ?? []).length} overrides on top of defaults`, () => go("sla")],
    [(assets?.registered ?? 0) > 0, "Devices onboarded and mapped", `${assets?.registered ?? 0} registered · ${assets?.discovered ?? 0} discovered`, () => nav("/assets")],
    [(channels ?? []).some((c) => c.enabled), "Notification channels configured", `${(channels ?? []).length} channels`, () => go("notifications")],
    [(keys ?? []).some((k) => !k.revoked_at), "Integration API key issued", `${(keys ?? []).filter((k) => !k.revoked_at).length} active keys`, () => go("keys")],
  ];
  const done = items.filter((i) => i[0]).length;
  return (
    <div className="grid main-side">
      <div className="card">
        <h3><Icon name="ListChecks" size={16} /> {done} of {items.length} done</h3>
        <div className="progress" style={{ marginBottom: 12 }}><i style={{ width: `${(done / items.length) * 100}%`, background: "#22c55e" }} /></div>
        {items.map(([ok, title, sub, fn], n) => (
          <div key={n} className="check">
            <Icon name={ok ? "Check" : "Minus"} size={18} color={ok ? "#16a34a" : "#cbd5e1"} />
            <div style={{ flex: 1 }}><b>{title}</b><div className="hint">{sub}</div></div>
            {!ok && <button className="btn sm" onClick={fn}>Set up</button>}
          </div>
        ))}
      </div>
      <div className="card">
        <h3>{tenant?.cityName ?? "City"}</h3>
        <dl className="kv"><dt>Authority</dt><dd>{tenant?.name}</dd><dt>Plan</dt><dd style={{ textTransform: "capitalize" }}>{tenant?.plan}</dd><dt>Modules</dt><dd>{(tenant?.modules ?? []).length}</dd><dt>Device quota</dt><dd>{tenant?.effectiveQuotas?.devices ?? "–"}</dd><dt>User quota</dt><dd>{tenant?.effectiveQuotas?.users ?? "–"}</dd></dl>
        <p className="hint">Plan, modules and quotas are managed by the platform administrator.</p>
      </div>
    </div>
  );
}

function Zones() {
  const { me } = useAuth();
  const { data: tenant, reload } = useApi<any>(me ? `/tenants/${me.tenantId}` : null);
  const [zones, setZones] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string>();
  useEffect(() => { if (tenant?.zones) setZones(tenant.zones); }, [tenant]);
  async function save() { await apiSend("PUT", `/tenants/${me!.tenantId}`, { zones }); setMsg("Zones saved"); await reload(); }
  return (
    <div className="grid main-side">
      <div className="card">
        <div className="hint" style={{ marginBottom: 8 }}>Type a zone name, then click the map at its centre.</div>
        <CityMap center={tenant?.center ?? { lat: 28.6139, lon: 77.209 }} height={460} showLegend={false} live={false}
          incidents={zones.map((z, n) => ({ id: `z${n}`, title: z.name, severity: "Low", lat: z.lat, lon: z.lon }))}
          onPick={(lat, lon) => { if (name.trim()) { setZones([...zones, { name: name.trim(), lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 }]); setName(""); } }} />
      </div>
      <div className="card">
        <h3><Icon name="Map" size={16} /> Zones ({zones.length})</h3>
        <label className="field">New zone name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chandni Chowk" /></label>
        {zones.map((z, n) => <div key={n} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}><span>{z.name} <span className="hint">{z.lat}, {z.lon}</span></span><button className="btn sm" onClick={() => setZones(zones.filter((_, i) => i !== n))}><Icon name="X" size={12} /></button></div>)}
        <button className="btn primary mt" onClick={save}>Save zones</button>
        {msg && <span className="badge green" style={{ marginLeft: 8 }}>{msg}</span>}
        <p className="hint mt">New zones appear in the onboarding wizard, incident forms and citizen preferences straight away. Re-provision from the platform console to create matching ThingsBoard zone assets.</p>
      </div>
    </div>
  );
}

function Departments() {
  const { data, reload } = useApi<any[]>("/departments");
  const [edit, setEdit] = useState<any>();
  const owned = useMemo(() => new Set((data ?? []).flatMap((d) => d.categories ?? [])), [data]);
  async function save() { await apiSend("POST", "/departments", edit); setEdit(undefined); await reload(); }
  return (
    <div className="card">
      <h3><Icon name="Building" size={16} /> Departments and category routing <button className="btn sm primary" style={{ marginLeft: "auto" }} onClick={() => setEdit({ name: "", head: "", email: "", phone: "", categories: [] })}><Icon name="Plus" size={14} /> Add department</button></h3>
      <p className="hint" style={{ marginTop: -6 }}>A new incident goes to the department of its device (from the registry) or, if none, the department that owns its category.</p>
      {CATEGORIES.filter((c) => !owned.has(c)).length > 0 && <div className="banner warning">Categories with no owner (incidents fall back to Operations): {CATEGORIES.filter((c) => !owned.has(c)).map((c) => DOMAINS[c]?.label ?? c).join(", ")}</div>}
      <table className="tbl"><thead><tr><th>Department</th><th>Head</th><th>Contact</th><th>Owns categories</th><th></th></tr></thead><tbody>
        {(data ?? []).map((d) => (
          <tr key={d.id}><td><b>{d.name}</b><div className="hint mono">{d.id}</div></td><td>{d.head ?? "–"}</td><td>{d.email ?? "–"}</td>
            <td><div className="row" style={{ flexWrap: "wrap", gap: 4 }}>{(d.categories ?? []).map((c: string) => <span key={c} className="badge blue">{DOMAINS[c]?.label ?? c}</span>)}</div></td>
            <td><button className="btn sm" onClick={() => setEdit({ ...d })}>Edit</button> <button className="btn sm danger" onClick={async () => { await apiSend("DELETE", `/departments/${d.id}`); await reload(); }}>Remove</button></td></tr>
        ))}
      </tbody></table>
      {edit && (
        <Modal title={edit.id ? `Edit ${edit.name}` : "New department"} onClose={() => setEdit(undefined)} footer={<><button className="btn" onClick={() => setEdit(undefined)}>Cancel</button><button className="btn primary" disabled={edit.name.length < 2} onClick={save}>Save</button></>}>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <label className="field">Name<input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field">Head (username)<input value={edit.head ?? ""} onChange={(e) => setEdit({ ...edit, head: e.target.value })} /></label>
            <label className="field">Email<input value={edit.email ?? ""} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
            <label className="field">Phone<input value={edit.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
          </div>
          <div className="hint mt">Owns categories</div>
          <div className="chips mt">{CATEGORIES.map((c) => <button key={c} className={`chip${edit.categories.includes(c) ? " on" : ""}`} onClick={() => setEdit({ ...edit, categories: edit.categories.includes(c) ? edit.categories.filter((x: string) => x !== c) : [...edit.categories, c] })}>{DOMAINS[c]?.label ?? c}</button>)}</div>
        </Modal>
      )}
    </div>
  );
}

function Users() {
  const { data, reload, error } = useApi<any[]>("/users");
  const { data: depts } = useApi<any[]>("/departments");
  const [invite, setInvite] = useState<any>();
  const [secret, setSecret] = useState<string>();
  const [err, setErr] = useState<string>();
  const [q, setQ] = useState("");
  async function create() {
    setErr(undefined);
    try { const r = await apiSend<any>("POST", "/users", { ...invite, email: invite.email || undefined, department: invite.department || undefined }); setSecret(`${r.username}: ${r.temporaryPassword}`); setInvite(undefined); await reload(); }
    catch (e) { setErr((e as Error).message); }
  }
  const list = (data ?? []).filter((u) => !q || `${u.username} ${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="grid main-side">
      <div className="card">
        <div className="filters">
          <label className="field" style={{ flex: 1 }}>Search<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="btn primary" onClick={() => setInvite({ username: "", firstName: "", lastName: "", email: "", role: "operator", department: "" })}><Icon name="UserPlus" size={15} /> Invite user</button>
        </div>
        {error && <div className="banner warning">{error}</div>}
        {secret && <div className="banner"><Icon name="KeyRound" size={15} /> Temporary password (shown once): <b className="mono">{secret}</b><button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setSecret(undefined)}>Done</button></div>}
        <table className="tbl"><thead><tr><th>User</th><th>Persona</th><th>Department</th><th>Status</th><th></th></tr></thead><tbody>
          {list.map((u) => (
            <tr key={u.id}>
              <td><b>{u.username}</b><div className="hint">{[u.firstName, u.lastName].filter(Boolean).join(" ")} {u.email ? `· ${u.email}` : ""}</div></td>
              <td><select className="field-input" value={u.roles?.[0] ?? ""} onChange={async (e) => { await apiSend("PUT", `/users/${u.id}`, { role: e.target.value }); await reload(); }}>{CITY_ROLES.map((r) => <option key={r} value={r}>{PERSONA_META[r].label}</option>)}</select></td>
              <td>{u.department ?? "–"}</td>
              <td><span className={`badge ${u.enabled ? "green" : "grey"}`}>{u.enabled ? "Active" : "Disabled"}</span></td>
              <td className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={async () => { await apiSend("PUT", `/users/${u.id}`, { enabled: !u.enabled }); await reload(); }}>{u.enabled ? "Disable" : "Enable"}</button>
                <button className="btn sm" onClick={async () => { const r = await apiSend<any>("POST", `/users/${u.id}/reset-password`); setSecret(`${u.username}: ${r.temporaryPassword}`); }}>Reset password</button>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>
      <div className="card">
        <h3><Icon name="Shield" size={16} /> What each persona can do</h3>
        {CITY_ROLES.map((r) => <div key={r} className="check"><Icon name={PERSONA_META[r].icon} size={16} color={PERSONA_META[r].color} /><div><b>{PERSONA_META[r].label}</b><div className="hint">{PERSONA_META[r].description}</div></div></div>)}
      </div>
      {invite && (
        <Modal title="Invite user" onClose={() => setInvite(undefined)} footer={<><button className="btn" onClick={() => setInvite(undefined)}>Cancel</button><button className="btn primary" disabled={!/^[a-z0-9._-]{3,40}$/.test(invite.username)} onClick={create}>Create user</button></>}>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <label className="field">Username<input value={invite.username} onChange={(e) => setInvite({ ...invite, username: e.target.value.toLowerCase() })} placeholder="operator3.delhi" /></label>
            <label className="field">Email<input value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></label>
            <label className="field">First name<input value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} /></label>
            <label className="field">Last name<input value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} /></label>
            <label className="field">Persona<select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>{CITY_ROLES.map((r) => <option key={r} value={r}>{PERSONA_META[r].label}</option>)}</select></label>
            <label className="field">Department (heads and technicians)<select value={invite.department} onChange={(e) => setInvite({ ...invite, department: e.target.value })}><option value="">—</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          </div>
          <ErrorNote msg={err} />
        </Modal>
      )}
    </div>
  );
}

function SlaMatrix() {
  const { data, reload } = useApi<any>("/sla/policies");
  const [cat, setCat] = useState("*");
  const [rows, setRows] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    if (!data) return;
    const out: Record<string, any> = {};
    for (const s of SEVERITIES) {
      const o = (data.overrides ?? []).find((x: any) => x.category === cat && x.severity === s);
      const d = data.defaults?.[s] ?? {};
      out[s] = o ? { responseMin: o.response_min, resolutionMin: o.resolution_min, amberPct: o.amber_pct, escalateTo: o.escalate_to, autoEscalate: o.auto_escalate, override: true }
        : { responseMin: d.responseMin, resolutionMin: d.resolutionMin, amberPct: d.amberPct ?? 75, escalateTo: d.escalateTo ?? "", autoEscalate: !!d.autoEscalate, override: false };
    }
    setRows(out);
  }, [data, cat]);
  const set = (s: string, k: string, v: any) => setRows((r) => ({ ...r, [s]: { ...r[s], [k]: v, override: true } }));
  async function save() {
    await apiSend("PUT", "/sla/policies", SEVERITIES.filter((s) => rows[s]?.override).map((s) => ({ category: cat, severity: s, responseMin: Number(rows[s].responseMin), resolutionMin: Number(rows[s].resolutionMin), amberPct: Number(rows[s].amberPct), escalateTo: rows[s].escalateTo ?? "", autoEscalate: !!rows[s].autoEscalate })));
    setMsg("Saved. New incidents use these targets."); await reload();
  }
  const covered = new Set((data?.overrides ?? []).map((o: any) => o.category));
  return (
    <div className="grid main-side">
      <div className="card">
        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={`chip${cat === "*" ? " on" : ""}`} onClick={() => setCat("*")}>Any category</button>
          {CATEGORIES.map((c) => <button key={c} className={`chip${cat === c ? " on" : ""}`} onClick={() => setCat(c)}>{DOMAINS[c]?.label ?? c}{covered.has(c) ? " •" : ""}</button>)}
        </div>
        <table className="tbl"><thead><tr><th>Severity</th><th>Response (min)</th><th>Resolution (min)</th><th>Amber at %</th><th>Escalate to</th><th>Auto-escalate</th><th></th></tr></thead><tbody>
          {SEVERITIES.map((s) => rows[s] && (
            <tr key={s}>
              <td><b>{s}</b></td>
              <td><input className="field-input" style={{ width: 80 }} value={rows[s].responseMin} onChange={(e) => set(s, "responseMin", e.target.value)} /></td>
              <td><input className="field-input" style={{ width: 90 }} value={rows[s].resolutionMin} onChange={(e) => set(s, "resolutionMin", e.target.value)} /> <span className="hint">{Math.round(Number(rows[s].resolutionMin) / 60 * 10) / 10} h</span></td>
              <td><input className="field-input" style={{ width: 70 }} value={rows[s].amberPct} onChange={(e) => set(s, "amberPct", e.target.value)} /></td>
              <td><input className="field-input" value={rows[s].escalateTo} onChange={(e) => set(s, "escalateTo", e.target.value)} placeholder="dept_head,city_admin" /></td>
              <td><input type="checkbox" checked={!!rows[s].autoEscalate} onChange={(e) => set(s, "autoEscalate", e.target.checked)} /></td>
              <td>{rows[s].override ? <span className="badge blue">override</span> : <span className="hint">default</span>}</td>
            </tr>
          ))}
        </tbody></table>
        <button className="btn primary mt" onClick={save}>Save {cat === "*" ? "city-wide" : DOMAINS[cat]?.label} targets</button>
        {msg && <span className="badge green" style={{ marginLeft: 8 }}>{msg}</span>}
      </div>
      <div className="card">
        <h3>How SLA clocks work</h3>
        <div className="check"><Icon name="Play" size={16} color="#16a34a" /><div><b>Both clocks start at creation</b><div className="hint">Response and resolution targets are taken from the most specific row: category first, then "Any category".</div></div></div>
        <div className="check"><Icon name="Check" size={16} color="#2563eb" /><div><b>Acknowledge stops response</b><div className="hint">Assigning a new incident counts as acknowledging it.</div></div></div>
        <div className="check"><Icon name="Flag" size={16} color="#dc2626" /><div><b>Breach escalates</b><div className="hint">Amber at the threshold, red at the target; with auto-escalate on, the incident escalates and the target roles are notified.</div></div></div>
        <div className="check"><Icon name="Clock" size={16} color="#64748b" /><div><b>Closure stops resolution</b><div className="hint">Reopening restarts the resolution clock.</div></div></div>
      </div>
    </div>
  );
}

function Notifications() {
  const { data: channels, reload } = useApi<any[]>("/notifications/channels");
  const { data: sent } = useApi<any[]>("/notifications", 30_000);
  const { data: depts } = useApi<any[]>("/departments");
  const [f, setF] = useState<any>();
  async function save() { await apiSend("POST", "/notifications/channels", { ...f, secret: f.secret || undefined, department: f.department || undefined }); setF(undefined); await reload(); }
  return (
    <div className="grid cols-2">
      <div className="card">
        <h3><Icon name="Bell" size={16} /> Rules <button className="btn sm primary" style={{ marginLeft: "auto" }} onClick={() => setF({ channel: "email", target: "", events: ["incident.created"], minSeverity: "High", department: "", secret: "" })}><Icon name="Plus" size={14} /> Add rule</button></h3>
        <table className="tbl"><thead><tr><th>Channel</th><th>Target</th><th>Events</th><th>Min</th><th>On</th><th></th></tr></thead><tbody>
          {(channels ?? []).map((c) => (
            <tr key={c.id}><td>{c.channel}</td><td className="mono" style={{ fontSize: 12 }}>{c.target}{c.department ? <div className="hint">{c.department}</div> : null}</td><td style={{ fontSize: 12 }}>{(c.events ?? []).join(", ")}</td><td>{c.min_severity}</td>
              <td><input type="checkbox" checked={c.enabled} onChange={async (e) => { await apiSend("PUT", `/notifications/channels/${c.id}`, { enabled: e.target.checked }); await reload(); }} /></td>
              <td><button className="btn sm danger" onClick={async () => { await apiSend("DELETE", `/notifications/channels/${c.id}`); await reload(); }}><Icon name="Trash2" size={13} /></button></td></tr>
          ))}
        </tbody></table>
        <p className="hint">Use target <span className="mono">$assignee</span> to email whoever a work order is assigned to. Webhooks post JSON (Teams / Slack compatible) signed with the secret.</p>
      </div>
      <div className="card">
        <h3><Icon name="Send" size={16} /> Recently sent</h3>
        {(sent ?? []).slice(0, 12).map((n) => <div key={n.id} className="alert-item"><div className="t"><b>{n.subject}</b><span>{n.channel} → {n.recipient} · {timeAgo(n.at)}</span></div><span className={`badge ${n.status === "sent" ? "green" : "red"}`}>{n.status}</span></div>)}
        {!sent?.length && <div className="empty">Nothing sent yet</div>}
      </div>
      {f && (
        <Modal title="Notification rule" onClose={() => setF(undefined)} footer={<><button className="btn" onClick={() => setF(undefined)}>Cancel</button><button className="btn primary" disabled={f.target.length < 3 || !f.events.length} onClick={save}>Save rule</button></>}>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <label className="field">Channel<select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="email">Email</option><option value="sms">SMS</option><option value="push">Push</option><option value="webhook">Webhook (Teams / Slack)</option></select></label>
            <label className="field">Target<input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} placeholder={f.channel === "webhook" ? "https://…" : f.channel === "sms" ? "+91…" : "team@city.gov"} /></label>
            <label className="field">Minimum severity<select value={f.minSeverity} onChange={(e) => setF({ ...f, minSeverity: e.target.value })}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="field">Only department<select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}><option value="">Any</option>{(depts ?? []).map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}</select></label>
            {f.channel === "webhook" && <label className="field">Signing secret<input value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>}
          </div>
          <div className="hint mt">Events</div>
          <div className="chips mt">{EVENTS.map((ev) => <button key={ev} className={`chip${f.events.includes(ev) ? " on" : ""}`} onClick={() => setF({ ...f, events: f.events.includes(ev) ? f.events.filter((x: string) => x !== ev) : [...f.events, ev] })}>{ev}</button>)}</div>
        </Modal>
      )}
    </div>
  );
}

function Keys() {
  const { me } = useAuth();
  const tenant = me?.tenantId ?? "delhi";
  const { data: keys, reload } = useApi<any[]>(`/tenants/${tenant}/api-keys`);
  const { data: connectors } = useApi<any>("/connectors");
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string>();
  async function createKey() { const r = await apiSend<any>("POST", `/tenants/${tenant}/api-keys`, { name }); setNewKey(r.key); setName(""); await reload(); }
  return (
    <div className="grid cols-2">
      <div className="card">
        <h3><Icon name="KeyRound" size={16} /> Integration API keys</h3>
        <p className="hint" style={{ marginTop: -6 }}>For systems that post device data to the ingest service (<span className="mono">POST /v1/telemetry</span>, header <span className="mono">x-api-key</span>). Data lands on Kafka first.</p>
        <div className="row" style={{ margin: "12px 0" }}>
          <label className="field" style={{ flex: 1 }}><input placeholder="Key name, e.g. Water SCADA gateway" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn primary" disabled={name.length < 2} onClick={createKey}><Icon name="Plus" size={15} /> Create</button>
        </div>
        {newKey && <div className="card" style={{ padding: 12, background: "#f0fdf4" }}><b>Copy now, shown once:</b><div className="code">{newKey}</div></div>}
        <table className="tbl mt"><thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th></th></tr></thead><tbody>
          {(keys ?? []).map((k) => (
            <tr key={k.id}><td>{k.name}</td><td className="mono">{k.prefix}…</td><td>{timeAgo(k.created_at)}</td>
              <td>{k.revoked_at ? <span className="badge grey">revoked</span> : <button className="btn sm danger" onClick={async () => { await apiSend("DELETE", `/tenants/${tenant}/api-keys/${k.id}`); await reload(); }}>Revoke</button>}</td></tr>
          ))}
        </tbody></table>
      </div>
      <div className="card">
        <h3><Icon name="Link" size={16} /> Connectors</h3>
        <dl className="kv">
          <dt>Weather</dt><dd>{connectors?.weather?.provider ?? "–"} every {connectors?.weather?.intervalMin ?? "–"} min</dd>
          <dt>Public events</dt><dd>{connectors?.events?.provider ?? "–"}</dd>
          <dt>Traffic feed</dt><dd>{connectors?.traffic?.provider ?? "–"}</dd>
          <dt>CSV batches</dt><dd className="mono">{connectors?.batch?.endpoint ?? "–"}</dd>
        </dl>
        <div className="code mt">{`curl -X POST http://localhost:8091/v1/telemetry \\
  -H 'x-api-key: <key>' -H 'content-type: application/json' \\
  -d '{"records":[{"deviceId":"WN-KB-201","values":{"pressureBar":2.9}}]}'`}</div>
      </div>
    </div>
  );
}
