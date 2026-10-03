import { createRemoteJWKSet, jwtVerify } from "jose";
import { env, envBool, HttpError } from "@scaas/common";
import { PERSONAS, tenantFromGroups, departmentsFromGroups, type Persona } from "./access.ts";

export interface Identity {
  userId: string;
  userName: string;
  displayName: string;
  email?: string;
  roles: Persona[];
  tenantId: string;
  departments: string[];
}

const ISSUER = env("OIDC_ISSUER", "http://localhost:8180/realms/scaas");
const JWKS_URL = env("OIDC_JWKS_URL", "http://keycloak:8080/realms/scaas/protocol/openid-connect/certs");
const AUDIENCE = process.env.OIDC_AUDIENCE; // optional
const ALLOW_DEV_TOKENS = envBool("ALLOW_DEV_TOKENS", false);
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

/**
 * Bearer token from Keycloak (OIDC). For local API testing only, ALLOW_DEV_TOKENS=true also accepts
 * "Bearer dev:<username>:<tenant>:<role,role>".
 */
export async function identify(authHeader: string | undefined, switchTenant?: string): Promise<Identity> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token) throw new HttpError(401, "Bearer token required");

  if (ALLOW_DEV_TOKENS && token.startsWith("dev:")) {
    const [, user, tenant, roles] = token.split(":");
    const r = (roles ?? "").split(",").filter((x): x is Persona => PERSONAS.includes(x as Persona));
    return { userId: `dev-${user}`, userName: user, displayName: user, roles: r, tenantId: r.includes("super_admin") && switchTenant ? switchTenant : tenant, departments: [] };
  }

  let payload: any;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: AUDIENCE }));
  } catch (err) {
    throw new HttpError(401, `Invalid token: ${(err as Error).message}`);
  }
  const roles = ((payload.realm_access?.roles ?? []) as string[]).filter((x): x is Persona => PERSONAS.includes(x as Persona));
  if (!roles.length) throw new HttpError(403, "User has no SCaaS persona role");
  const groups = payload.groups as string[] | undefined;
  let tenantId = tenantFromGroups(groups);
  if (roles.includes("super_admin")) tenantId = switchTenant || tenantId || "platform";
  if (!tenantId) throw new HttpError(403, "User is not a member of any tenant");
  return {
    userId: payload.sub,
    userName: payload.preferred_username ?? payload.sub,
    displayName: payload.name ?? payload.preferred_username ?? "User",
    email: payload.email,
    roles,
    tenantId,
    departments: departmentsFromGroups(groups),
  };
}
