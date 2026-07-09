import { auth } from '@clerk/nextjs/server';
import { pool } from '@/lib/db.ts';
import { resolveTenant } from '@/lib/tenant.ts';

export const dynamic = 'force-dynamic';

/**
 * Determinism brain (MVP). For each agent, group its runs by execution *shape*
 * (the label sequence), then for every node measure how often its canonical
 * value agrees across runs. Stable nodes are candidates to replace with a
 * deterministic tool (≥90) or cache (70–89); the rest we keep. Mirrors
 * @ccopt/core's scoreDeterminism, reimplemented here so the dashboard needs no
 * workspace dep on Vercel.
 */

interface Step {
  kind: 'model_turn' | 'tool_use' | 'tool_result' | 'thinking';
  name: string;
  payload: string;
  model?: string;
  tokens?: { input: number; output: number };
}
interface Parsed { steps?: Step[] }
interface RunRow { agent_id: string; parsed: Parsed }

const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-4': { in: 15, out: 75 }, 'claude-sonnet-4': { in: 3, out: 15 }, 'claude-haiku-4': { in: 0.8, out: 4 },
  'gpt-4o': { in: 2.5, out: 10 }, 'gpt-4o-mini': { in: 0.15, out: 0.6 },
};
const stepUsd = (s: Step) => {
  if (!s.tokens) return 0;
  const p = PRICE[s.model ?? 'claude-sonnet-4'] ?? PRICE['claude-sonnet-4'];
  return (s.tokens.input * p.in + s.tokens.output * p.out) / 1e6;
};

// canonical value: lowercase + whitespace collapsed only. Digits are kept — a
// value that differs run-to-run (a region-dependent tax rate, a row count) is
// genuinely non-deterministic and must NOT be collapsed into "the same value".
const canon = (s: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
const sortedKeys = (json: string) => {
  try { return Object.keys(JSON.parse(json)).sort().join(','); } catch { return ''; }
};
const label = (s: Step) => {
  if (s.kind === 'tool_use') return `tool:${s.name}(${sortedKeys(s.payload)})`;
  if (s.kind === 'tool_result') return `result:${s.name}`;
  if (s.kind === 'model_turn') return `llm`;
  return 'think';
};
const modal = (vals: string[]) => {
  const c: Record<string, number> = {};
  let best = '', bestN = 0;
  for (const v of vals) { c[v] = (c[v] ?? 0) + 1; if (c[v] > bestN) { bestN = c[v]; best = v; } }
  return { value: best, count: bestN };
};

const KIND_LABEL: Record<string, string> = { model_turn: 'LLM step', tool_use: 'Tool input', tool_result: 'Tool output', thinking: 'Reasoning' };

export async function GET(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = await resolveTenant({ userId, orgId: orgId ?? null });
  const agentFilter = new URL(req.url).searchParams.get('agent') || undefined;

  const { rows } = await pool.query<RunRow>(
    agentFilter
      ? `select agent_id, parsed from runs where tenant_id = $1 and agent_id = $2`
      : `select agent_id, parsed from runs where tenant_id = $1`,
    agentFilter ? [tenantId, agentFilter] : [tenantId],
  );

  // group runs by agent
  const byAgent = new Map<string, Step[][]>();
  for (const r of rows) {
    const steps = r.parsed?.steps;
    if (!steps?.length) continue;
    (byAgent.get(r.agent_id) ?? byAgent.set(r.agent_id, []).get(r.agent_id)!).push(steps);
  }

  const insights = [];
  for (const [agentId, runs] of byAgent) {
    // group by execution shape (label sequence); take the dominant shape
    const shapes = new Map<string, Step[][]>();
    for (const steps of runs) {
      const key = steps.map(label).join('>');
      (shapes.get(key) ?? shapes.set(key, []).get(key)!).push(steps);
    }
    const [, cluster] = [...shapes.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const runCount = cluster.length;
    if (runCount < 2) continue;

    const len = Math.min(...cluster.map((s) => s.length));
    const opportunities = [];
    let scoreSum = 0;
    for (let i = 0; i < len; i++) {
      const vals = cluster.map((s) => canon(s[i].payload));
      const { count } = modal(vals);
      const score = Math.round((count / runCount) * 100);
      scoreSum += score;
      const proto = cluster[0][i];
      const action = score >= 90 ? 'replace' : score >= 70 ? 'cache' : 'keep';
      if (action === 'keep') continue;
      // savings: sum this node's LLM cost across the runs it's stable in
      const estUsd = cluster.reduce((s, steps) => s + stepUsd(steps[i]), 0);
      const estTokens = cluster.reduce((s, steps) => s + (steps[i].tokens ? steps[i].tokens!.input + steps[i].tokens!.output : 0), 0);
      opportunities.push({
        index: i,
        kind: proto.kind,
        kindLabel: KIND_LABEL[proto.kind] ?? proto.kind,
        name: proto.kind === 'model_turn' ? 'assistant' : proto.name,
        preview: (proto.payload ?? '').slice(0, 120),
        score,
        action,
        runs: runCount,
        estTokens,
        estUsd: Number(estUsd.toFixed(4)),
      });
    }
    opportunities.sort((a, b) => b.estUsd - a.estUsd || b.score - a.score);
    insights.push({
      agentId,
      runCount,
      steps: len,
      meanScore: Math.round(scoreSum / len),
      totalEstUsd: Number(opportunities.reduce((s, o) => s + o.estUsd, 0).toFixed(4)),
      opportunities,
    });
  }
  insights.sort((a, b) => b.totalEstUsd - a.totalEstUsd);
  return Response.json({ insights });
}
