import { logger } from "./logger.ts";

const hooks: Array<() => Promise<void>> = [];
let installed = false;

/** Register cleanup to run on SIGINT/SIGTERM (reverse order of registration). */
export function onShutdown(fn: () => Promise<void>): void {
  hooks.push(fn);
  if (installed) return;
  installed = true;
  const stop = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    for (const h of [...hooks].reverse()) {
      try { await h(); } catch (err) { logger.warn({ err }, "shutdown hook failed"); }
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

/** Retry an async start-up step until dependencies (Kafka, TB, DB) are reachable. */
export async function waitFor<T>(what: string, fn: () => Promise<T>, attempts = 60, delayMs = 5000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      logger.info({ what, attempt: i, error: (err as Error).message }, "waiting for dependency");
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
