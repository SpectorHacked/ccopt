import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Db = pg.Pool;

export function createPool(databaseUrl: string): Db {
  // Managed Postgres (Neon, RDS, Supabase) requires TLS; honor sslmode in the URL.
  const wantsSsl = /sslmode=(require|verify)/.test(databaseUrl);
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    ...(wantsSsl ? { ssl: true } : {}),
  });
}

/** Apply migrations in filename order. Idempotent (schema uses IF NOT EXISTS). */
export async function migrate(db: Db): Promise<void> {
  const dir = fileURLToPath(new URL('../migrations', import.meta.url));
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    await db.query(readFileSync(`${dir}/${f}`, 'utf8'));
  }
}
