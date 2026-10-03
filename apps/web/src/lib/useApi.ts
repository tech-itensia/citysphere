import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet } from "./api";

/** Fetch a gateway path; optional polling; returns { data, error, loading, reload, setData }. */
export function useApi<T = any>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(!!path);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const d = await apiGet<T>(path);
      if (alive.current) { setData(d); setError(undefined); }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    void load();
    const t = refreshMs ? setInterval(() => void load(), refreshMs) : undefined;
    return () => { alive.current = false; if (t) clearInterval(t); };
  }, [load, refreshMs]);

  return { data, error, loading, reload: load, setData };
}
