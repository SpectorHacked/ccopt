import { createHash } from 'node:crypto';
import { pool } from './db.ts';
import { sanitizeForJsonb } from './engine/jsonb.ts';
import { redactSensitive } from './engine/redact.ts';
import type { Run } from './engine/types.ts';

export const hashKey = (k: string) => createHash('sha256').update(k).digest('hex');

export interface AgentAuth {
  tenantId: string;
  role: string;
  /** Set when the key is agent-scoped — forces attribution to that agent. */
  agentId?: string;
  agentName?: string;
}

/** Bearer `cck_` key → tenant (+ bound agent for scoped keys). */
export async function authenticateKey(header: string | null): Promise<AgentAuth | null> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token || !token.startsWith('cck_')) return null;
  const { rows } = await pool.query<{ tenant_id: string; role: string; agent_id: string | null; agent_name: string | null }>(
    `select k.tenant_id, k.role, k.agent_id, a.name as agent_name
       from api_keys k left join agents a on a.id = k.agent_id
      where k.key_hash = $1`,
    [hashKey(token)],
  );
  if (!rows.length) return null;
  const r = rows[0];
  pool.query('update api_keys set last_used_at = now() where key_hash = $1', [hashKey(token)]).catch(() => {});
  return { tenantId: r.tenant_id, role: r.role, agentId: r.agent_id ?? undefined, agentName: r.agent_name ?? undefined };
}

/**
 * Persist a parsed Run — the single write path both capture shapes share.
 * Payloads are redacted + trimmed BEFORE storage (nothing sensitive is kept);
 * jsonb-hostile characters stripped (NULs, lone surrogates).
 */
export async function persistRun(auth: AgentAuth, sessionId: string, run: Run): Promise<void> {
  const trimmed: Run = sanitizeForJsonb({
    ...run,
    firstPrompt: run.firstPrompt ? redactSensitive(run.firstPrompt) : run.firstPrompt,
    finalOutput: run.finalOutput ? redactSensitive(run.finalOutput) : run.finalOutput,
    steps: run.steps.map((s) => ({ ...s, payload: redactSensitive(s.payload.slice(0, 8000)) })),
  });
  await pool.query(
    `insert into runs (tenant_id, session_id, agent_id, started_at, ended_at,
                       cost_usd, models, n_steps, blob_path, parsed)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (tenant_id, session_id) do update
       set agent_id = excluded.agent_id, started_at = excluded.started_at,
           ended_at = excluded.ended_at, cost_usd = excluded.cost_usd,
           models = excluded.models, n_steps = excluded.n_steps,
           parsed = excluded.parsed`,
    [
      auth.tenantId,
      sessionId,
      run.agentId,
      run.startedAt ?? null,
      run.endedAt ?? null,
      run.costUsd,
      JSON.stringify(run.models),
      run.steps.length,
      'inline', // no blob store on this deployment; parsed (redacted) is the record
      JSON.stringify(trimmed),
    ],
  );
}
