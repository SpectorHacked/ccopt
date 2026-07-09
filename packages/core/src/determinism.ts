/**
 * Per-node determinism scoring — the foundation of the optimization brain.
 *
 * Runs of the same shape (same L1 = same label sequence) are compared node by
 * node: how often does a node's canonical I/O value agree across runs? High
 * agreement ⇒ the step is deterministic ⇒ safe to compile away. Grounded in the
 * "total agreement rate" idea (arXiv:2408.04667) and the research score bands:
 *   ≥90  → replace with a compiled tool/rule
 *   70–89 → cache / route to a smaller model
 *   <70  → keep the LLM (too much variance)
 */
import type { RunGraph, StepKind } from './types.js';

export type DetAction = 'replace' | 'cache' | 'keep';

export interface NodeDeterminism {
  index: number;
  label: string;
  kind: StepKind;
  /** 0–100: % of runs whose value equals the modal value at this position. */
  score: number;
  agreement: number;
  distinctValues: number;
  runCount: number;
  action: DetAction;
}

export interface ClusterDeterminism {
  l1: string;
  agentId: string;
  runCount: number;
  labelSequence: string[];
  /** Mean score over scoreable nodes — the cluster's overall determinism. */
  meanScore: number;
  nodes: NodeDeterminism[];
}

function actionFor(score: number): DetAction {
  if (score >= 90) return 'replace';
  if (score >= 70) return 'cache';
  return 'keep';
}

/**
 * Score determinism per cluster. Only clusters with ≥ minRuns (default 2)
 * observations are scored — you can't judge stability from a single run. More
 * runs = higher confidence (surface runCount in the UI).
 */
export function scoreDeterminism(graphs: RunGraph[], opts: { minRuns?: number } = {}): ClusterDeterminism[] {
  const minRuns = opts.minRuns ?? 2;

  const groups = new Map<string, RunGraph[]>();
  for (const g of graphs) {
    const arr = groups.get(g.l1);
    if (arr) arr.push(g);
    else groups.set(g.l1, [g]);
  }

  const out: ClusterDeterminism[] = [];
  for (const [l1, gs] of groups) {
    const ref = gs[0];
    const n = ref.nodes.length;
    // Guard against rare L1 hash collisions: only compare same-length graphs.
    const same = gs.filter((g) => g.nodes.length === n);
    const runCount = same.length;
    if (runCount < minRuns) continue;

    const nodes: NodeDeterminism[] = [];
    let scoreSum = 0;
    let scored = 0;
    for (let i = 0; i < n; i++) {
      const { kind, label } = ref.nodes[i];
      const values = same.map((g) => g.nodes[i].canonicalValue);
      const scoreable = kind !== 'thinking' && values.some((v) => v.length > 0);

      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const modal = Math.max(...counts.values());
      const agreement = modal / runCount;
      const score = Math.round(agreement * 100);

      if (scoreable) {
        scoreSum += score;
        scored += 1;
      }
      nodes.push({
        index: i,
        label,
        kind,
        score,
        agreement,
        distinctValues: counts.size,
        runCount,
        action: scoreable ? actionFor(score) : 'keep',
      });
    }

    out.push({
      l1,
      agentId: ref.agentId,
      runCount,
      labelSequence: ref.labelSequence,
      meanScore: scored ? Math.round(scoreSum / scored) : 0,
      nodes,
    });
  }

  // Most-repeated clusters first — that's where the money is.
  out.sort((a, b) => b.runCount - a.runCount);
  return out;
}
