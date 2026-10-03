import { sevClass, ragClass, DEVICE_TONE } from "../lib/format";

export const SeverityBadge = ({ s }: { s?: string }) => <span className={`badge ${sevClass(s)}`}>{s ?? "–"}</span>;

const STATUS_TONE: Record<string, string> = {
  New: "red", Acknowledged: "amber", Assigned: "blue", "In Progress": "blue", Escalated: "red", "Resolution Pending": "amber",
  Resolved: "green", Closed: "grey", Open: "amber", Accepted: "blue", "On Hold": "amber", Completed: "green", Verified: "green", Cancelled: "grey",
  active: "green", suspended: "red", failed: "red", pending: "amber", provisioning: "amber",
};
export const StatusBadge = ({ s }: { s?: string }) => <span className={`badge ${STATUS_TONE[s ?? ""] ?? "grey"}`}>{s ?? "–"}</span>;
export const DeviceStatusBadge = ({ s }: { s?: string }) => <span className={`badge ${DEVICE_TONE[s ?? ""] ?? "grey"}`}>{s ?? "–"}</span>;

const RAG_LABEL: Record<string, string> = { green: "On track", amber: "Near breach", red: "Breached", met: "Met", met_late: "Met late" };
export const SlaBadge = ({ r, label }: { r?: string; label?: string }) =>
  r ? <span className={`badge ${ragClass(r)}`}>{label ? `${label}: ` : ""}{RAG_LABEL[r] ?? r}</span> : <span className="badge grey">–</span>;

export const Online = ({ on }: { on?: boolean }) => <span className={`badge ${on ? "green" : "grey"}`}>{on ? "Online" : "Offline"}</span>;
