import { Pool } from 'pg';

// Single pooled client, cached on globalThis so serverless/dev hot-reload doesn't
// open a new pool per invocation. Use Neon's pooled connection string in prod.
const url = process.env.DATABASE_URL ?? 'postgres://effigent:effigent@localhost:5433/effigent';
const needsSsl = /sslmode=(require|verify)/.test(url);

const g = globalThis as unknown as { __effigentPool?: Pool };
export const pool: Pool =
  g.__effigentPool ??
  new Pool({
    connectionString: url,
    max: 5,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
if (!g.__effigentPool) g.__effigentPool = pool;
