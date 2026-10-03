import { useEffect, useRef } from "react";
import { session, isDemo } from "./api";
import { mockLiveEvent } from "./mock";

export type LiveEvent = { event: string; data: any; at: number };
type Handler = (e: LiveEvent) => void;

/**
 * Live updates from the gateway (Server-Sent Events: incident, sla, workorder, alert, twin).
 * In demo mode a timer produces simulated events so the screens stay alive.
 */
export function useLive(handler: Handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | undefined;
    let demoTimer: ReturnType<typeof setInterval> | undefined;
    const emit = (event: string, data: any) => ref.current({ event, data, at: Date.now() });

    const startDemo = () => {
      if (demoTimer) return;
      demoTimer = setInterval(() => { const e = mockLiveEvent(); emit(e.event, e.data); }, 2500);
    };

    if (isDemo() || !session.token) {
      startDemo();
    } else {
      es = new EventSource(`/api/stream?access_token=${encodeURIComponent(session.token)}`);
      for (const name of ["incident", "sla", "workorder", "alert", "twin"]) {
        es.addEventListener(name, (m: MessageEvent) => { try { emit(name, JSON.parse(m.data)); } catch { /* ignore */ } });
      }
      es.onerror = () => { if (isDemo()) { es?.close(); startDemo(); } };
    }
    return () => { es?.close(); if (demoTimer) clearInterval(demoTimer); };
  }, [enabled]);
}
