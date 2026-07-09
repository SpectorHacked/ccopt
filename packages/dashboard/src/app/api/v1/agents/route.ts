import { auth } from '@clerk/nextjs/server';
import { pool } from '@/lib/db.ts';
import { resolveTenant } from '@/lib/tenant.ts';

export const dynamic = 'force-dynamic';

/**
 * This tenant's agents, derived from their runs. `optimized` is true when the
 * agent has been through an optimization pass (agents.optimized_at set). That
 * column is optional — the query degrades gracefully if its migration hasn't
 * been applied yet.
 */
export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = await resolveTenant({ userId, orgId: orgId ?? null });

  const hasOptCol =
    (
      await pool.query(
        `select 1 from information_schema.columns where table_name = 'agents' and column_name = 'optimized_at'`,
      )
    ).rowCount ?? 0;
  const optimizedExpr = hasOptCol
    ? `(select a.optimized_at is not null from agents a
          where a.tenant_id = runs.tenant_id and a.name = runs.agent_id)`
    : `false`;

  const { rows } = await pool.query(
    `select agent_id,
            count(*)::int           as n_runs,
            round(sum(cost_usd), 2) as total_cost_usd,
            max(started_at)         as last_seen,
            coalesce(${optimizedExpr}, false) as optimized,
            (select coalesce(jsonb_agg(distinct m), '[]'::jsonb)
               from runs r2, jsonb_array_elements_text(r2.models) m
              where r2.tenant_id = runs.tenant_id and r2.agent_id = runs.agent_id) as models
       from runs
      where tenant_id = $1
      group by tenant_id, agent_id
      order by sum(cost_usd) desc`,
    [tenantId],
  );
  return Response.json({ agents: rows, tenantId });
}
