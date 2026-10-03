/** Commercial plans: quotas and included modules. Pure. A city's own `quotas` override its plan's numbers. */
export const MODULES = [
  { id: "command_centre", name: "Command Centre" },
  { id: "digital_twin", name: "Digital Twin" },
  { id: "sla_workorders", name: "SLA & Work Orders" },
  { id: "citizen_portal", name: "Citizen Portal" },
  { id: "analytics", name: "Analytics & Reports" },
  { id: "integrations", name: "Integrations & API" },
] as const;
export type ModuleId = (typeof MODULES)[number]["id"];

export interface Quotas { devices: number; users: number; apiCallsPerDay: number; retentionDays: number }

export const PLANS: Record<string, { name: string; priceNote: string; quotas: Quotas; modules: ModuleId[] }> = {
  starter: { name: "Starter", priceNote: "Pilot / single department", quotas: { devices: 500, users: 25, apiCallsPerDay: 100_000, retentionDays: 30 }, modules: ["command_centre", "digital_twin", "citizen_portal"] },
  standard: { name: "Standard", priceNote: "City-wide operations", quotas: { devices: 5_000, users: 150, apiCallsPerDay: 2_000_000, retentionDays: 90 }, modules: ["command_centre", "digital_twin", "sla_workorders", "citizen_portal", "analytics"] },
  enterprise: { name: "Enterprise", priceNote: "Metro scale, all modules", quotas: { devices: 50_000, users: 2_000, apiCallsPerDay: 20_000_000, retentionDays: 365 }, modules: MODULES.map((m) => m.id) },
};

export function effectiveQuotas(plan: string, overrides: Partial<Quotas> = {}): Quotas {
  const base = (PLANS[plan] ?? PLANS.standard).quotas;
  return { ...base, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => typeof v === "number" && v > 0)) } as Quotas;
}

/** Modules a city may use: its explicit list, limited to what its plan includes (enterprise = all). */
export function effectiveModules(plan: string, modules: string[] | null | undefined): ModuleId[] {
  const allowed = (PLANS[plan] ?? PLANS.standard).modules;
  const chosen = modules?.length ? modules : allowed;
  return allowed.filter((m) => chosen.includes(m));
}
