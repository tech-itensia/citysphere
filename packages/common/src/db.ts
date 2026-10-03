import pg from "pg";
import { common } from "./config.ts";
import { onShutdown } from "./lifecycle.ts";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: common.databaseUrl(), max: 10 });
    onShutdown(async () => { await pool?.end(); });
  }
  return pool;
}

/**
 * Run work inside a transaction scoped to one tenant.
 * Postgres Row-Level Security policies read app.tenant_id, so a query can never see another city's rows.
 * Pass "*" only for platform-level (super admin) work.
 */
export async function withTenant<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
