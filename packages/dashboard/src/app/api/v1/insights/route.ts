import { auth } from '@clerk/nextjs/server';
import { pool } from '@/lib/db.ts';
import { resolveTenant } from '@/lib/tenant.ts';

export const dynamic = 'force-dynamic';

/**
 * Determinism brain v2. Analyzes each agent's last WINDOW (40) sessions:
 *
 *  - Clusters runs by execution shape (label sequence) and analyzes EVERY
 *    cluster with enough support — not just the dominant one.
 *  - Per node, four detectors (strongest wins):
 *      replace   — canonical value identical across runs (score ≥ 90 + support)
 *      memoize   — tool output is a pure function of its input (same input ⇒
 *                  same output), even when outputs differ across runs
 *      template  — value is structurally fixed with a few volatile data slots
 *                  ⇒ synthesize a parameterized tool
 *      route     — LLM step with moderate stability ⇒ smaller model
 *      cache     — moderately stable value (70–89)
 *  - Confidence = Wilson lower bound of the agreement at the observed sample
 *    size, so 2 agreeing runs never outrank 30.
 *
 * Mirrors packages/core/src/determinism.ts (v2); reimplemented leanly because
 * the dashboard can't take a workspace dep on Vercel. Keep the two in sync.
 */

const WINDOW = 40; // sessions analyzed per agent
const MIN_RUNS = 2; // minimum cluster support to score at all

interface Step {
  kind: 'model_turn' | 'tool_use' | 'tool_result' | 'thinking';
  name: string;
  payload: string;
  toolUseId?: string;
  model?: string;
  tokens?: { input: number; output: number };
}
interface RunRow { agent_id: string; steps: Step[] | null }

const PRICE: Record<string, { in: number; out: number }> = {
  'claude-opus-4': { in: 15, out: 75 }, 'claude-sonnet-4': { in: 3, out: 15 }, 'claude-haiku-4': { in: 0.8, out: 4 },
  'gpt-4o': { in: 2.5, out: 10 }, 'gpt-4o-mini': { in: 0.15, out: 0.6 },
};
const stepUsd = (s: Step) => {
  if (!s.tokens) return 0;
  const p = PRICE[s.model ?? 'claude-sonnet-4'] ?? PRICE['claude-sonnet-4'];
  return (s.tokens.input * p.in + s.tokens.output * p.out) / 1e6;
};

// Canonical value: lowercase + whitespace collapsed. Digits are KEPT — numeric
// variation is real non-determinism (the memoize/template detectors decide
// whether it's input-driven or structural).
const canon = (s: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
const sortedKeys = (json: string) => {
  try { return Object.keys(JSON.parse(json)).sort().join(','); } catch { return ''; }
};
const label = (s: Step) => {
  if (s.kind === 'tool_use') return `tool:${s.name}(${sortedKeys(s.payload)})`;
  if (s.kind === 'tool_result') return `result:${s.name}`;
  if (s.kind === 'model_turn') return 'llm';
  return 'think';
};

const modal = (vals: string[]) => {
  const c = new Map<string, number>();
  let bestN = 0;
  for (const v of vals) { const n = (c.get(v) ?? 0) + 1; c.set(v, n); if (n > bestN) bestN = n; }
  return { count: bestN, distinct: c.size };
};

/** 95% Wilson lower bound on the agreement proportion — small samples score low. */
function wilsonLower(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96, p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

/** Functional determinism: does the same tool input always produce the same output? */
function memoizeScore(cluster: Step[][], i: number): { score: number; coverage: number } | null {
  const pairs: Array<{ input: string; output: string }> = [];
  for (const steps of cluster) {
    const res = steps[i];
    // pair with its tool_use: same toolUseId looking back, else the previous step
    let use: Step | undefined;
    if (res.toolUseId) {
      for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
        if (steps[j].kind === 'tool_use' && steps[j].toolUseId === res.toolUseId) { use = steps[j]; break; }
      }
    }
    if (!use && steps[i - 1]?.kind === 'tool_use') use = steps[i - 1];
    if (!use) return null;
    pairs.push({ input: canon(use.payload), output: canon(res.payload) });
  }
  const groups = new Map<string, string[]>();
  for (const p of pairs) (groups.get(p.input) ?? groups.set(p.input, []).get(p.input)!).push(p.output);
  let agree = 0, total = 0;
  for (const outs of groups.values()) {
    if (outs.length < 2) continue; // singleton inputs can't witness purity
    agree += modal(outs).count;
    total += outs.length;
  }
  if (total === 0) return null;
  return { score: Math.round((agree / total) * 100), coverage: total / pairs.length };
}

/** Positional token comparison → structural stability + a slotted template preview. */
function templateInfo(values: string[]): { stability: number; template: string; slots: number } | null {
  const toks = values.map((v) => v.split(' '));
  const lenCounts = new Map<number, number>();
  for (const t of toks) lenCounts.set(t.length, (lenCounts.get(t.length) ?? 0) + 1);
  const modalLen = [...lenCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const sameLen = toks.filter((t) => t.length === modalLen);
  if (modalLen === 0 || sameLen.length < values.length * 0.7) return null; // structure itself varies
  let constant = 0;
  const parts: string[] = [];
  for (let j = 0; j < modalLen; j++) {
    const col = sameLen.map((t) => t[j]);
    if (col.every((x) => x === col[0])) { constant++; parts.push(col[0]); }
    else parts.push('⟨·⟩');
  }
  return { stability: constant / modalLen, template: parts.join(' ').slice(0, 160), slots: modalLen - constant };
}

type Action = 'replace' | 'memoize' | 'template' | 'route' | 'cache' | 'keep';
const KIND_LABEL: Record<string, string> = { model_turn: 'LLM step', tool_use: 'Tool input', tool_result: 'Tool output', thinking: 'Reasoning' };

export async function GET(req: Request) {
  const { userId, orgId } = await auth();
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const tenantId = await resolveTenant({ userId, orgId: orgId ?? null });
  const agentFilter = new URL(req.url).searchParams.get('agent') || undefined;

  // Only the last WINDOW sessions per agent, and only the step list — not the
  // whole parsed blob. Keeps the scan bounded no matter how much history exists.
  const { rows } = await pool.query<RunRow>(
    `select agent_id, steps from (
       select agent_id, parsed->'steps' as steps,
              row_number() over (partition by agent_id order by started_at desc nulls last) as rn
         from runs where tenant_id = $1 ${agentFilter ? 'and agent_id = $2' : ''}
     ) w where rn <= ${WINDOW}`,
    agentFilter ? [tenantId, agentFilter] : [tenantId],
  );

  const byAgent = new Map<string, Step[][]>();
  for (const r of rows) {
    if (!r.steps?.length) continue;
    (byAgent.get(r.agent_id) ?? byAgent.set(r.agent_id, []).get(r.agent_id)!).push(r.steps);
  }

  const insights = [];
  for (const [agentId, runs] of byAgent) {
    const shapes = new Map<string, Step[][]>();
    for (const steps of runs) {
      const key = steps.map(label).join('>');
      (shapes.get(key) ?? shapes.set(key, []).get(key)!).push(steps);
    }

    // Analyze EVERY cluster with support; merge opportunities per agent.
    const merged = new Map<string, {
      kind: Step['kind']; name: string; preview: string; template?: string;
      score: number; confidence: number; action: Action; runs: number;
      estTokens: number; estUsd: number; index: number;
    }>();
    let clustered = 0, scoreSum = 0, scored = 0;

    for (const cluster of shapes.values()) {
      const runCount = cluster.length;
      if (runCount < MIN_RUNS) continue;
      clustered += runCount;
      const len = Math.min(...cluster.map((s) => s.length));

      for (let i = 0; i < len; i++) {
        const proto = cluster[0][i];
        const values = cluster.map((s) => canon(s[i].payload));
        const { count } = modal(values);
        const fullScore = Math.round((count / runCount) * 100);
        const conf = wilsonLower(count, runCount);
        scoreSum += fullScore; scored++;

        let action: Action = 'keep';
        let score = fullScore;
        let template: string | undefined;

        if (fullScore >= 90 && conf >= 0.6) action = 'replace';
        else if (proto.kind === 'tool_result') {
          const fn = memoizeScore(cluster, i);
          if (fn && fn.score >= 90 && fn.coverage >= 0.5) { action = 'memoize'; score = fn.score; }
        }
        if (action === 'keep' && (proto.kind === 'model_turn' || proto.kind === 'tool_use')) {
          const t = templateInfo(values);
          if (t && t.stability >= 0.85 && t.slots > 0) { action = 'template'; score = Math.round(t.stability * 100); template = t.template; }
          else if (proto.kind === 'model_turn' && t && t.stability >= 0.55) { action = 'route'; score = Math.round(t.stability * 100); }
        }
        if (action === 'keep' && fullScore >= 70) action = 'cache';
        if (action === 'keep') continue;

        // Confidence follows the detector that won, not raw full-value agreement
        // (a memoized node's values legitimately differ across runs).
        const detConf = action === 'replace' || action === 'cache' ? conf : wilsonLower(Math.round((score / 100) * runCount), runCount);

        const estUsd = cluster.reduce((s, steps) => s + stepUsd(steps[i]), 0);
        const estTokens = cluster.reduce((s, steps) => s + (steps[i].tokens ? steps[i].tokens!.input + steps[i].tokens!.output : 0), 0);
        const key = `${action}|${label(proto)}|${i}`;
        const prev = merged.get(key);
        if (prev) { prev.runs += runCount; prev.estUsd += estUsd; prev.estTokens += estTokens; }
        else {
          merged.set(key, {
            index: i, kind: proto.kind, name: proto.kind === 'model_turn' ? 'assistant' : proto.name,
            preview: (proto.payload ?? '').slice(0, 120), template,
            score, confidence: Math.round(detConf * 100), action, runs: runCount, estTokens, estUsd,
          });
        }
      }
    }
    if (!clustered) continue;

    const opportunities = [...merged.values()]
      .map((o) => ({ ...o, estUsd: Number(o.estUsd.toFixed(4)), kindLabel: KIND_LABEL[o.kind] ?? o.kind }))
      .sort((a, b) => b.estUsd - a.estUsd || b.score - a.score);

    insights.push({
      agentId,
      runCount: runs.length,
      window: WINDOW,
      clusters: [...shapes.values()].filter((c) => c.length >= MIN_RUNS).length,
      coverage: Math.round((clustered / runs.length) * 100),
      steps: Math.max(...runs.map((r) => r.length)),
      meanScore: scored ? Math.round(scoreSum / scored) : 0,
      totalEstUsd: Number(opportunities.reduce((s, o) => s + o.estUsd, 0).toFixed(4)),
      opportunities,
    });
  }
  insights.sort((a, b) => b.totalEstUsd - a.totalEstUsd);
  return Response.json({ insights, window: WINDOW });
}
