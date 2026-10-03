/** Minimal Prometheus counters/gauges without extra dependencies. */
type Labels = Record<string, string>;
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const help = new Map<string, string>();

const keyOf = (name: string, labels?: Labels) =>
  labels && Object.keys(labels).length
    ? `${name}{${Object.entries(labels).map(([k, v]) => `${k}="${String(v).replace(/"/g, '\\"')}"`).join(",")}}`
    : name;

export function inc(name: string, labels?: Labels, by = 1, description?: string): void {
  const k = keyOf(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
  if (description) help.set(name, description);
}

export function setGauge(name: string, value: number, labels?: Labels): void {
  gauges.set(keyOf(name, labels), value);
}

export function renderMetrics(): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const emit = (map: Map<string, number>, type: string) => {
    for (const [k, v] of map) {
      const name = k.split("{")[0];
      if (!seen.has(name)) {
        seen.add(name);
        if (help.has(name)) lines.push(`# HELP ${name} ${help.get(name)}`);
        lines.push(`# TYPE ${name} ${type}`);
      }
      lines.push(`${k} ${v}`);
    }
  };
  emit(counters, "counter");
  emit(gauges, "gauge");
  return lines.join("\n") + "\n";
}
