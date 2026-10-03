import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { navFor, PERSONA_META, primaryPersona } from "../lib/personas";
import { onDemoChange, isDemo } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Icon } from "./Icon";

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 48 48" aria-label="Smart City">
      <defs>
        <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2563eb" /><stop offset="1" stopColor="#7c3aed" /></linearGradient>
      </defs>
      <path d="M24 3 42 13v22L24 45 6 35V13z" fill="url(#lg1)" opacity=".18" />
      <path d="M15 16 24 11l9 5v20l-9 5-9-5z" fill="url(#lg1)" />
      <rect x="20" y="18" width="3" height="18" rx="1" fill="#fff" opacity=".9" />
      <rect x="25" y="14" width="3" height="22" rx="1" fill="#fff" opacity=".7" />
    </svg>
  );
}

export function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  if (!me) return null;
  const nav = navFor(me.roles, me.city?.modules);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-btn${isActive ? " active" : ""}`}>
            <Icon name={n.icon} size={21} />
            <span className="tip">{n.label}</span>
          </NavLink>
        ))}
        <div className="spacer" />
        <button className="nav-btn" onClick={() => navigate(me.home)} title="Home"><Icon name="Sun" size={20} /><span className="tip">Home workspace</span></button>
        <button className="nav-btn" onClick={logout}><Icon name="LogOut" size={20} /><span className="tip">Sign out</span></button>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}

/** Page header in the style of the design: big title, search, weather, alerts bell, avatar, system status. */
export function Page({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const { me, switchTenant } = useAuth();
  const [demo, setDemo] = useState(isDemo());
  useEffect(() => onDemoChange(setDemo), []);
  const { data: overview } = useApi<any>(me && !me.roles.includes("citizen") && !me.roles.every((r) => r === "field_tech") ? "/overview" : null, 30_000);
  const { data: tenants } = useApi<any[]>(me?.roles.includes("super_admin") ? "/tenants" : null);
  const { data: announcements } = useApi<any[]>(me ? "/announcements" : null, 120_000);
  const [hidden, setHidden] = useState<string[]>([]);
  const weather = overview?.weather;
  const critical = overview?.twin?.statusCounts?.Critical ?? 0;
  const attention = (overview?.twin?.statusCounts?.Attention ?? 0) + (overview?.twin?.statusCounts?.Moderate ?? 0);
  const initials = (me?.displayName ?? "U").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const persona = me ? PERSONA_META[primaryPersona(me.roles)] : undefined;

  return (
    <>
      <div className="topbar">
        <div className="title">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="center">
          <label className="search"><Icon name="Search" size={18} /><input placeholder="Search anything..." aria-label="Search" /></label>
        </div>
        <div className="right">
          {demo && <span className="demo-badge" title="The API gateway is not reachable; showing demo data">Demo data</span>}
          {tenants && (
            <select className="btn sm" value={me?.tenantId} onChange={(e) => switchTenant(e.target.value)} aria-label="City">
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.cityName ?? t.name}</option>)}
            </select>
          )}
          {weather && (
            <div className="weather"><Icon name="Sun" size={22} /><div><b>{Math.round(weather.temperatureC ?? 0)}°C</b><span>{overview?.tenant?.cityName ?? "City"}</span></div></div>
          )}
          <button className="icon-btn" aria-label="Notifications"><Icon name="Bell" size={19} />{overview?.incidents?.open ? <span className="dot" /> : null}</button>
          <div className="icon-btn avatar" title={`${me?.displayName} · ${persona?.label}`}>{initials}</div>
        </div>
      </div>
      <div className="row between" style={{ marginTop: -14, marginBottom: 20 }}>
        <div className="row">{actions}</div>
        {overview && (
          <span className={`status-pill${critical ? " bad" : attention ? " warn" : ""}`}>
            <i />{critical ? `${critical} system(s) critical` : attention ? `${attention} system(s) need attention` : "All Systems Operational"}
          </span>
        )}
      </div>
      {(announcements ?? []).filter((a) => !hidden.includes(a.id)).slice(0, 2).map((a) => (
        <div key={a.id} className={`banner ${a.level}`}>
          <Icon name={a.level === "critical" ? "AlertTriangle" : "Info"} size={16} />
          <div style={{ flex: 1 }}><b>{a.title}</b>{a.body ? ` — ${a.body}` : ""}{a.tenantId === "*" && <span className="hint"> · Platform notice</span>}</div>
          <button className="btn sm" onClick={() => setHidden((h) => [...h, a.id])} aria-label="Dismiss"><Icon name="X" size={13} /></button>
        </div>
      ))}
      {children}
    </>
  );
}
