/** Small typed env reader shared by every service. */
export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

export function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${name} must be a number`);
  return n;
}

export function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

/** Settings every service needs. */
export const common = {
  serviceName: () => env("SERVICE_NAME", "scaas-service"),
  kafkaBrokers: () => env("KAFKA_BROKERS", "localhost:29092").split(","),
  redisUrl: () => env("REDIS_URL", "redis://localhost:6379"),
  databaseUrl: () => env("DATABASE_URL", "postgres://scaas_app:scaas_app@localhost:5432/scaas"),
  internalToken: () => env("INTERNAL_TOKEN", "dev-internal-token-change-me"),
  port: () => envInt("PORT", 3000),
};
