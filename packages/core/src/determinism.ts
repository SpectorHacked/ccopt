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

/* ------------------------------------------------------------------------- *
 * v2 — pattern-level analysis (windowed, multi-detector)
 *
 * Beyond exact value agreement, v2 detects:
 *   memoize  — a tool result that is a pure function of its input (same input
 *              ⇒ same output), even when outputs differ across runs
 *   template — a value that is structurally fixed with a few volatile data
 *              slots ⇒ synthesize a parameterized tool
 *   route    — an LLM step with moderate structural stability ⇒ smaller model
 * and weighs everything by a Wilson lower bound so 2 agreeing runs never
 * outrank 30. The dashboard's /api/v1/insights mirrors this file — keep them
 * in sync.
 * ------------------------------------------------------------------------- */

export type DetActionV2 = 'replace' | 'memoize' | 'template' | 'route' | 'cache' | 'keep';

export interface NodeAnalysis {
  index: number;
  label: string;
  kind: StepKind;
  score: number;
  /** 95% Wilson lower bound of the agreement, 0–100. */
  confidence: number;
  action: DetActionV2;
  /** Slotted preview when action === 'template' ("⟨·⟩" marks volatile slots). */
  template?: string;
  runCount: number;
}

export interface ClusterAnalysis {
  l1: string;
  agentId: string;
  runCount: number;
  labelSequence: string[];
  meanScore: number;
  nodes: NodeAnalysis[];
}

/** 95% Wilson lower bound on a proportion — small samples score low. */
export function wilsonLower(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denom);
}

function modalCount(values: string[]): number {
  const counts = new Map<string, number>();
  let best = 0;
  for (const v of values) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > best) best = n;
  }
  return best;
}

/** Same tool input ⇒ same tool output? Pairs each result with the nearest
 *  preceding tool_use; groups outputs by input; scores within-group agreement. */
function memoizeScore(graphs: RunGraph[], i: number): { score: number; coverage: number } | null {
  const pairs: Array<{ input: string; output: string }> = [];
  for (const g of graphs) {
    let use = -1;
    for (let j = i - 1; j >= 0 && j >= i - 4; j--) {
      if (g.nodes[j].kind === 'tool_use') { use = j; break; }
    }
    if (use < 0) return null;
    pairs.push({ input: g.nodes[use].canonicalValue, output: g.nodes[i].canonicalValue });
  }
  const groups = new Map<string, string[]>();
  for (const p of pairs) {
    const arr = groups.get(p.input);
    if (arr) arr.push(p.output);
    else groups.set(p.input, [p.output]);
  }
  let agree = 0;
  let total = 0;
  for (const outs of groups.values()) {
    if (outs.length < 2) continue; // singleton inputs can't witness purity
    agree += modalCount(outs);
    total += outs.length;
  }
  if (total === 0) return null;
  return { score: Math.round((agree / total) * 100), coverage: total / pairs.length };
}

/** Positional token comparison → structural stability + slotted template. */
function templateInfo(values: string[]): { stability: number; template: string; slots: number } | null {
  const toks = values.map((v) => v.split(' '));
  const lenCounts = new Map<number, number>();
  for (const t of toks) lenCounts.set(t.length, (lenCounts.get(t.length) ?? 0) + 1);
  let modalLen = 0;
  let bestN = 0;
  for (const [len, n] of lenCounts) if (n > bestN) { bestN = n; modalLen = len; }
  const sameLen = toks.filter((t) => t.length === modalLen);
  if (modalLen === 0 || sameLen.length < values.length * 0.7) return null;
  let constant = 0;
  const parts: string[] = [];
  for (let j = 0; j < modalLen; j++) {
    const col = sameLen.map((t) => t[j]);
    if (col.every((x) => x === col[0])) { constant += 1; parts.push(col[0]); }
    else parts.push('⟨·⟩');
  }
  return { stability: constant / modalLen, template: parts.join(' ').slice(0, 160), slots: modalLen - constant };
}

/**
 * v2 cluster analysis over a window of runs (callers should pre-slice to the
 * most recent ~40 sessions per agent). Analyzes every shape cluster with
 * ≥ minRuns support — not just the dominant one.
 */
export function analyzeDeterminism(graphs: RunGraph[], opts: { minRuns?: number } = {}): ClusterAnalysis[] {
  const minRuns = opts.minRuns ?? 2;

  const groups = new Map<string, RunGraph[]>();
  for (const g of graphs) {
    const arr = groups.get(g.l1);
    if (arr) arr.push(g);
    else groups.set(g.l1, [g]);
  }

  const out: ClusterAnalysis[] = [];
  for (const [l1, gs] of groups) {
    const ref = gs[0];
    const n = ref.nodes.length;
    const same = gs.filter((g) => g.nodes.length === n);
    const runCount = same.length;
    if (runCount < minRuns) continue;

    const nodes: NodeAnalysis[] = [];
    let scoreSum = 0;
    let scored = 0;
    for (let i = 0; i < n; i++) {
      const { kind, label } = ref.nodes[i];
      const values = same.map((g) => g.nodes[i].canonicalValue);
      const scoreable = kind !== 'thinking' && values.some((v) => v.length > 0);
      const count = modalCount(values);
      const fullScore = Math.round((count / runCount) * 100);
      const conf = wilsonLower(count, runCount);

      let action: DetActionV2 = 'keep';
      let score = fullScore;
      let template: string | undefined;

      if (scoreable) {
        scoreSum += fullScore;
        scored += 1;
        if (fullScore >= 90 && conf >= 0.6) action = 'replace';
        else if (kind === 'tool_result') {
          const fn = memoizeScore(same, i);
          if (fn && fn.score >= 90 && fn.coverage >= 0.5) { action = 'memoize'; score = fn.score; }
        }
        if (action === 'keep' && (kind === 'model_turn' || kind === 'tool_use')) {
          const t = templateInfo(values);
          if (t && t.stability >= 0.85 && t.slots > 0) { action = 'template'; score = Math.round(t.stability * 100); template = t.template; }
          else if (kind === 'model_turn' && t && t.stability >= 0.55) { action = 'route'; score = Math.round(t.stability * 100); }
        }
        if (action === 'keep' && fullScore >= 70) action = 'cache';
      }

      // Confidence follows the detector that won — a memoized node's values
      // legitimately differ across runs, so raw agreement would undersell it.
      const detConf =
        action === 'memoize' || action === 'template' || action === 'route'
          ? wilsonLower(Math.round((score / 100) * runCount), runCount)
          : conf;
      nodes.push({ index: i, label, kind, score, confidence: Math.round(detConf * 100), action, template, runCount });
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

  out.sort((a, b) => b.runCount - a.runCount);
  return out;
}
