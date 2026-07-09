#!/usr/bin/env node
/**
 * Applies tenant plan limits (migration 008) and provisions the Design
 * Partners workspace:
 *  - alter table tenants add column if not exists max_agents integer
 *  - Design Partners org tenant → max_agents = 5
 *  - Test Organization (demo)   → max_agents = 100
 *
 * Usage: PROD_DATABASE_URL="postgres://…?sslmode=require" node scripts/setup-limits.mjs
 */
import pg from 'pg';

const url = process.env.PROD_DATABASE_URL;
if (!url) { console.error('Set PROD_DATABASE_URL.'); process.exit(1); }

const DEMO_REF = 'org:org_3GH8j31HWvYWd0VijevoNtliBqv'; // Test Organization
const PARTNER_REF = 'org:org_3GHiOTxCBjuyms3RmjQpBemlHB4'; // Design Partners
const PARTNER_MAX_AGENTS = 5;

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

await c.query('alter table tenants add column if not exists max_agents integer');

// find-or-create the Design Partners tenant (mirrors resolveTenant)
const found = await c.query('select id from tenants where clerk_ref = $1', [PARTNER_REF]);
if (!found.rows.length) {
  await c.query('insert into tenants (name, clerk_ref) values ($1,$2)', ['Design Partners', PARTNER_REF]);
}
await c.query('update tenants set max_agents = $2 where clerk_ref = $1', [PARTNER_REF, PARTNER_MAX_AGENTS]);
await c.query('update tenants set max_agents = 100 where clerk_ref = $1', [DEMO_REF]);

const { rows } = await c.query(
  `select name, clerk_ref, coalesce(max_agents, 2) as max_agents,
          (select count(*)::int from agents a where a.tenant_id = t.id) as agents
     from tenants t where clerk_ref is not null order by created_at`,
);
console.table(rows);
await c.end();
console.log('Done. Default for unlisted tenants: 2 agents (Free tier).');
