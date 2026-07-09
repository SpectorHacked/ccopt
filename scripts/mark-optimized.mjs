#!/usr/bin/env node
/**
 * Applies the agents.optimized_at column (migration 007), ensures an agents row
 * exists per agent seen in runs, and marks the given agent(s) as optimized so
 * the dashboard's "Optimized" indicator lights up.
 *
 * Usage:
 *   PROD_DATABASE_URL="postgres://…?sslmode=require" \
 *     node scripts/mark-optimized.mjs --agent invoice-reconciliation
 *
 *   # unmark:   --unmark invoice-reconciliation
 *   # no flag → just applies the column + agents rows, marks nothing
 */
import pg from 'pg';

const url = process.env.PROD_DATABASE_URL;
if (!url) { console.error('Set PROD_DATABASE_URL.'); process.exit(1); }
const argv = process.argv.slice(2);
const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const mark = val('--agent');
const unmark = val('--unmark');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// 1. schema (idempotent — migration 007)
await c.query('alter table agents add column if not exists optimized_at timestamptz');

// 2. ensure an agents row per distinct agent that has runs (all tenants)
await c.query(`insert into agents (tenant_id, name, harness)
               select distinct tenant_id, agent_id, null from runs
               on conflict (tenant_id, name) do nothing`);

// 3. (un)mark
if (mark) await c.query('update agents set optimized_at = now() where name = $1', [mark]);
if (unmark) await c.query('update agents set optimized_at = null where name = $1', [unmark]);

const { rows } = await c.query('select name, optimized_at is not null as optimized from agents order by name');
console.table(rows);
await c.end();
console.log('Done.');
