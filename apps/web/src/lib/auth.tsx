import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { session, apiGet } from "./api";
import { DEMO_USERS, primaryPersona, PERSONA_META, type Persona } from "./personas";

export interface Me {
  userId: string;
  userName: string;
  displayName: string;
  roles: Persona[];
  tenantId: string;
  departments: string[];
  home: string;
  mode: "sso" | "demo";
}

interface AuthState {
  me: Me | null;
  ready: boolean;
  loginDemo: (username: string) => Promise<void>;
  loginSso: () => Promise<void>;
  logout: () => void;
  switchTenant: (tenantId: string) => void;
}

const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
};

const KC_URL = import.meta.env.VITE_KEYCLOAK_URL ?? "http://localhost:8180";
const KC_REALM = import.meta.env.VITE_KEYCLOAK_REALM ?? "scaas";
const KC_CLIENT = import.meta.env.VITE_KEYCLOAK_CLIENT ?? "scaas-web";

const store = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
};

/** Identity for a demo persona; the gateway accepts these "dev:" tokens when ALLOW_DEV_TOKENS=true. */
function demoIdentity(username: string): { token: string; me: Me } {
  const u = DEMO_USERS.find((x) => x.username === username) ?? DEMO_USERS[3];
  const token = `dev:${u.username}:${u.tenant}:${u.persona}`;
  return {
    token,
    me: {
      userId: `dev-${u.username}`, userName: u.username, displayName: u.name, roles: [u.persona], tenantId: u.tenant,
      departments: u.persona === "dept_head" || u.persona === "field_tech" ? ["water"] : [], home: PERSONA_META[u.persona].home, mode: "demo",
    },
  };
}

let kc: any;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const fromGateway = useCallback(async (fallback: Me): Promise<Me> => {
    try {
      const m = await apiGet<any>("/me");
      if (!m) return fallback;
      return { ...m, mode: fallback.mode, home: m.home ?? PERSONA_META[primaryPersona(m.roles)].home };
    } catch {
      return fallback;
    }
  }, []);

  // Restore session on load (demo persona or Keycloak SSO).
  useEffect(() => {
    (async () => {
      const demoUser = store.get("scaas.demoUser");
      if (demoUser) {
        const { token, me: m } = demoIdentity(demoUser);
        session.token = token;
        setMe(await fromGateway(m));
      } else if (store.get("scaas.sso") === "1") {
        try {
          const { default: Keycloak } = await import("keycloak-js");
          kc = new Keycloak({ url: KC_URL, realm: KC_REALM, clientId: KC_CLIENT });
          const ok = await kc.init({ onLoad: "login-required", pkceMethod: "S256", checkLoginIframe: false });
          if (ok) {
            session.token = kc.token;
            setInterval(() => { kc.updateToken(60).then(() => { session.token = kc.token; }).catch(() => kc.login()); }, 30_000);
            const p = kc.tokenParsed ?? {};
            const roles = ((p.realm_access?.roles ?? []) as string[]).filter((r) => r in PERSONA_META) as Persona[];
            const tenant = ((p.groups ?? []) as string[]).map((g) => /tenants\/([a-z0-9-]+)/.exec(g)?.[1]).find(Boolean) ?? "delhi";
            const fallback: Me = { userId: p.sub, userName: p.preferred_username, displayName: p.name ?? p.preferred_username, roles, tenantId: tenant, departments: [], home: PERSONA_META[primaryPersona(roles)].home, mode: "sso" };
            setMe(await fromGateway(fallback));
          }
        } catch (err) {
          console.error("Keycloak init failed", err);
          store.del("scaas.sso");
        }
      }
      setReady(true);
    })();
  }, [fromGateway]);

  const loginDemo = useCallback(async (username: string) => {
    const { token, me: m } = demoIdentity(username);
    store.set("scaas.demoUser", username);
    session.token = token;
    setMe(await fromGateway(m));
  }, [fromGateway]);

  const loginSso = useCallback(async () => {
    store.set("scaas.sso", "1");
    window.location.reload();
  }, []);

  const logout = useCallback(() => {
    store.del("scaas.demoUser");
    session.token = undefined;
    session.tenantOverride = undefined;
    if (store.get("scaas.sso") === "1" && kc) {
      store.del("scaas.sso");
      kc.logout({ redirectUri: window.location.origin });
      return;
    }
    setMe(null);
  }, []);

  const switchTenant = useCallback((tenantId: string) => {
    session.tenantOverride = tenantId;
    setMe((m) => (m ? { ...m, tenantId } : m));
  }, []);

  return <Ctx.Provider value={{ me, ready, loginDemo, loginSso, logout, switchTenant }}>{children}</Ctx.Provider>;
}
