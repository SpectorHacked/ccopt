import { authenticateKey } from '@/lib/agent-auth.ts';
import { pool } from '@/lib/db.ts';

export const dynamic = 'force-dynamic';

/** Key-validation endpoint (`effigent login` probes it) + report metadata list. */
export async function GET(req: Request) {
  const auth = await authenticateKey(req.headers.get('authorization'));
  if (!auth) return Response.json({ error: 'invalid API key' }, { status: 401 });
  const { rows } = await pool.query(
    `select id, generated_at, window_days, totals from reports
      where tenant_id = $1 order by generated_at desc limit 20`,
    [auth.tenantId],
  );
  return Response.json({ reports: rows });
}
