import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Db = pg.Pool;

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
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
