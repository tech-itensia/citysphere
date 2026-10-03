import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { DEMO_USERS, PERSONA_META } from "../lib/personas";
import { Icon } from "../components/Icon";

export function Login() {
  const { loginDemo, loginSso } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="login">
      <div className="panel">
        <div className="card" style={{ padding: 32, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div>
            <svg width="54" height="54" viewBox="0 0 48 48" aria-hidden="true">
              <defs><linearGradient id="lgL" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2563eb" /><stop offset="1" stopColor="#7c3aed" /></linearGradient></defs>
              <path d="M15 16 24 11l9 5v20l-9 5-9-5z" fill="url(#lgL)" />
            </svg>
            <h1 style={{ fontSize: 34, lineHeight: 1.1, margin: "18px 0 10px" }}>Smart City<br />Operating System</h1>
            <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>
              Command Centre, digital twin, incidents, SLAs and work orders for every city on one multi-tenant platform.
            </p>
          </div>
          <div>
            <button className="btn primary" style={{ width: "100%", justifyContent: "center", padding: 14 }} onClick={() => loginSso()}>
              <Icon name="Shield" size={17} /> Sign in with SSO (Keycloak)
            </button>
            <p className="hint" style={{ marginTop: 10 }}>Demo users: <b>operator.delhi</b>, <b>mayor.delhi</b>… password <b>Demo@123</b></p>
          </div>
        </div>
        <div className="card" style={{ padding: 24 }}>
          <h3>Quick demo: pick a persona</h3>
          <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>Uses gateway dev tokens (ALLOW_DEV_TOKENS=true). Turn off in production.</p>
          <div className="grid cols-2" style={{ gap: 10 }}>
            {DEMO_USERS.map((u) => {
              const p = PERSONA_META[u.persona];
              return (
                <button key={u.username} className="persona" onClick={async () => { await loginDemo(u.username); navigate(p.home); }}>
                  <span className="pi" style={{ background: p.color }}><Icon name={p.icon} size={18} /></span>
                  <span><b>{p.label}</b><span>{p.description}</span></span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
