import { auth } from '@clerk/nextjs/server';
import { pool } from '@/lib/db.ts';
import { resolveTenant } from '@/lib/tenant.ts';

export const dynamic = 'force-dynamic';

/** One session's stored run (the parsed Run + its step list) for the DAG deep-dive. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = await resolveTenant({ userId, orgId: orgId ?? null });
  const { id } = await ctx.params;

  const { rows } = await pool.query(
    `select session_id, agent_id, started_at, ended_at, cost_usd, n_steps, models, parsed
       from runs where tenant_id = $1 and session_id = $2 limit 1`,
    [tenantId, id],
  );
  if (!rows.length) return Response.json({ error: 'not found' }, { status: 404 });
  return Response.json({ run: rows[0] });
}
