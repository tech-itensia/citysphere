import { useState } from "react";
import { Page } from "../components/Layout";
import { useApi } from "../lib/useApi";
import { useAuth } from "../lib/auth";
import { apiSend } from "../lib/api";
import { Icon } from "../components/Icon";

/** Platform Super Admin: all city tenants and one-click onboarding (creates ThingsBoard tenant, profiles, rule chain). */
export function Platform() {
  const { switchTenant } = useAuth();
  const { data: tenants, reload } = useApi<any[]>("/tenants", 10_000);
  const [f, setF] = useState({ id: "", name: "", cityName: "", lat: "", lon: "" });
  const [msg, setMsg] = useState<string>();
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function onboard() {
    setMsg(undefined);
    try {
      await apiSend("POST", "/tenants", { id: f.id, name: f.name, cityName: f.cityName, center: { lat: Number(f.lat), lon: Number(f.lon) }, zones: [] });
      setMsg(`Provisioning ${f.cityName}…`); setF({ id: "", name: "", cityName: "", lat: "", lon: "" }); await reload();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <Page title="Platform Tenants" subtitle="Every city on the SCaaS platform. Onboarding provisions ThingsBoard automatically.">
      <div className="grid main-side">
        <div className="card">
          <h3><Icon name="Globe" size={17} /> Cities</h3>
          <table className="tbl"><thead><tr><th>ID</th><th>Name</th><th>City</th><th>Status</th><th>Zones</th><th></th></tr></thead><tbody>
            {(tenants ?? []).map((t) => (
              <tr key={t.id}>
                <td className="mono">{t.id}</td><td>{t.name}</td><td>{t.cityName}</td>
                <td><span className={`badge ${t.status === "active" ? "green" : t.status === "failed" ? "red" : "amber"}`} title={t.error}>{t.status}</span></td>
                <td>{(t.zones ?? []).length}</td>
                <td><button className="btn sm" onClick={() => switchTenant(t.id)}>Open</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
        <div className="card">
          <h3><Icon name="Plus" size={17} /> Onboard a city</h3>
          <div className="stack" style={{ gap: 10 }}>
            <label className="field">Tenant id<input value={f.id} onChange={(e) => set("id", e.target.value.toLowerCase())} placeholder="pune" /></label>
            <label className="field">Authority name<input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Pune Municipal Corporation" /></label>
            <label className="field">City<input value={f.cityName} onChange={(e) => set("cityName", e.target.value)} placeholder="Pune" /></label>
            <div className="grid cols-2" style={{ gap: 10 }}>
              <label className="field">Latitude<input value={f.lat} onChange={(e) => set("lat", e.target.value)} placeholder="18.52" /></label>
              <label className="field">Longitude<input value={f.lon} onChange={(e) => set("lon", e.target.value)} placeholder="73.856" /></label>
            </div>
            <button className="btn primary" disabled={!f.id || !f.name || !f.cityName || !f.lat || !f.lon} onClick={onboard}>Onboard city</button>
            {msg && <div className="hint">{msg}</div>}
          </div>
        </div>
      </div>
    </Page>
  );
}
