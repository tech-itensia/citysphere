import { sevClass, ragClass } from "../lib/format";

export const SeverityBadge = ({ s }: { s?: string }) => <span className={`badge ${sevClass(s)}`}>{s ?? "–"}</span>;

const STATUS_TONE: Record<string, string> = {
  New: "red", Acknowledged: "amber", Assigned: "blue", "In Progress": "blue", Reopened: "red", Resolved: "green",
  Verified: "green", Closed: "grey", Open: "amber", Accepted: "blue", "On Hold": "amber", Completed: "green", Cancelled: "grey",
};
export const StatusBadge = ({ s }: { s?: string }) => <span className={`badge ${STATUS_TONE[s ?? ""] ?? "grey"}`}>{s ?? "–"}</span>;

const RAG_LABEL: Record<string, string> = { green: "On track", amber: "Near breach", red: "Breached", met: "Met", met_late: "Met late" };
export const SlaBadge = ({ r, label }: { r?: string; label?: string }) =>
  r ? <span className={`badge ${ragClass(r)}`}>{label ? `${label}: ` : ""}{RAG_LABEL[r] ?? r}</span> : <span className="badge grey">–</span>;
