import { randomBytes, createHash } from 'node:crypto';
import { auth } from '@clerk/nextjs/server';
import { pool } from '@/lib/db.ts';
import { resolveTenant } from '@/lib/tenant.ts';

export const dynamic = 'force-dynamic';

/**
 * Workspace API keys. Keys are stored as SHA-256 hashes — the plaintext exists
 * only in the POST response that minted it. GET lists metadata (never values).
 */

export async function GET() {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = await resolveTenant({ userId, orgId: orgId ?? null });
  const { rows } = await pool.query(
    `select k.id, k.label, k.role, k.created_at, k.last_used_at, a.name as agent
       from api_keys k left join agents a on a.id = k.agent_id
      where k.tenant_id = $1
      order by k.created_at desc`,
    [tenantId],
  );
  return Response.json({ tenantId, keys: rows });
}

export async function POST(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = await resolveTenant({ userId, orgId: orgId ?? null });

  let label = 'workspace';
  try {
    const body = (await req.json()) as { label?: string };
    if (body.label && typeof body.label === 'string') label = body.label.slice(0, 60);
  } catch { /* empty body is fine */ }

  // Owner key: full workspace access — this is the key `ccopt login` takes.
  const apiKey = `cck_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(apiKey).digest('hex');
  await pool.query(
    `insert into api_keys (tenant_id, key_hash, label, role) values ($1,$2,$3,'owner')`,
    [tenantId, hash, label],
  );
  // Plaintext leaves the server exactly once, here.
  return Response.json({ apiKey, tenantId });
}
