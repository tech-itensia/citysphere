export const SEV_COLOR: Record<string, string> = { Critical: "#ef4444", High: "#f97316", Medium: "#f59e0b", Low: "#3b82f6" };
export const SEV_ORDER = ["Critical", "High", "Medium", "Low"];

/** Domain catalogue: label, colour and icon for each city system (matches packages/thingsboard catalog). */
export const DOMAINS: Record<string, { label: string; color: string; icon: string }> = {
  electricity: { label: "Electricity", color: "#f59e0b", icon: "Zap" },
  traffic: { label: "Roads", color: "#2563eb", icon: "Car" },
  water: { label: "Water", color: "#0ea5e9", icon: "Droplets" },
  emergency: { label: "Emergency Response", color: "#ef4444", icon: "Siren" },
  mobility: { label: "Drones & Fleet", color: "#8b5cf6", icon: "Navigation" },
  lighting: { label: "Street Lighting", color: "#eab308", icon: "Lightbulb" },
  environment: { label: "Air Quality", color: "#22c55e", icon: "Wind" },
  waste: { label: "Waste", color: "#64748b", icon: "Trash2" },
  parking: { label: "Parking", color: "#06b6d4", icon: "Car" },
  weather: { label: "Weather", color: "#0284c7", icon: "CloudRain" },
  events: { label: "Public Events", color: "#db2777", icon: "CalendarDays" },
  generic: { label: "Other", color: "#94a3b8", icon: "Box" },
};
export const domainOf = (d?: string) => DOMAINS[d ?? "generic"] ?? DOMAINS.generic;

export const STATUS_COLOR: Record<string, string> = { Operational: "#22c55e", Moderate: "#f59e0b", Attention: "#f97316", Critical: "#ef4444" };
export const statusWord = (pct: number) => (pct >= 95 ? "Healthy" : pct >= 85 ? "Moderate" : pct >= 70 ? "Attention" : "Critical");
export const statusTone = (pct: number) => (pct >= 95 ? "#16a34a" : pct >= 85 ? "#ea580c" : pct >= 70 ? "#f97316" : "#dc2626");

export function timeAgo(iso?: string | number): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const fmt = (n: number | undefined | null, digits = 0) =>
  n === undefined || n === null || Number.isNaN(n) ? "–" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: digits });

export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

export function sevClass(s?: string) { return (s ?? "low").toLowerCase(); }

export function ragClass(r?: string) {
  if (r === "red" || r === "met_late") return "red";
  if (r === "amber") return "amber";
  if (r === "met") return "green";
  return "green";
}
