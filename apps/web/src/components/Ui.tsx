import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { countdown } from "../lib/format";

/** Underlined tab bar; the active tab is remembered per page in the URL hash. */
export function Tabs({ tabs, value, onChange }: { tabs: Array<{ id: string; label: string; icon?: string; count?: number }>; value: string; onChange: (id: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={`tab${t.id === value ? " on" : ""}`} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={15} />}{t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function useTab(defaultId: string, ids: string[]): [string, (id: string) => void] {
  const read = () => { const h = window.location.hash.replace("#", ""); return ids.includes(h) ? h : defaultId; };
  const [tab, setTab] = useState(read);
  useEffect(() => { const f = () => setTab(read()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); });
  return [tab, (id: string) => { window.history.replaceState(null, "", `#${id}`); setTab(id); }];
}

export function Modal({ title, onClose, children, wide, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <>
      <div className="drawer-bg" onClick={onClose} />
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-label={typeof title === "string" ? title : "Dialog"}>
        <div className="row between"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn sm" onClick={onClose} aria-label="Close"><Icon name="X" size={15} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </>
  );
}

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="stepper">
      {steps.map((s, i) => (
        <li key={s} className={i < current ? "done" : i === current ? "on" : ""}>
          <span className="n">{i < current ? <Icon name="Check" size={13} /> : i + 1}</span><span className="l">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Live countdown to an ISO time; red when overdue. */
export function Countdown({ to, met }: { to?: string; met?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (met) return <span className="badge green">Met</span>;
  if (!to) return <span className="hint">–</span>;
  const ms = new Date(to).getTime() - now;
  return <span className={`countdown${ms < 0 ? " over" : ms < 10 * 60_000 ? " soon" : ""}`}>{countdown(ms)}</span>;
}

export function Kpi({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string; icon?: string }) {
  return (
    <div className="card kpi-card">
      <div className="hint row" style={{ gap: 6 }}>{icon && <Icon name={icon} size={14} />}{label}</div>
      <b style={{ fontSize: 26, color: tone }}>{value}</b>
      {sub && <div className="hint">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

export function ErrorNote({ msg }: { msg?: string }) { return msg ? <div className="badge red" style={{ display: "inline-block", margin: "8px 0" }}>{msg}</div> : null; }
