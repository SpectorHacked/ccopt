// VENDORED from packages/core|server (dashboard can't take workspace deps on Vercel).
/**
 * Knowledge graph — the agent's re-discovered world, materialized.
 *
 * Agents burn tokens re-learning the same facts every run: the same globs,
 * the same greps, the same config reads. The v3 lattice already knows which
 * of those lookups are STABLE (mechanical/cacheable calls whose answers agree
 * across runs) — this module turns them into queryable facts:
 *
 *   "what does src/**⁄*.ts contain?"  → the listing   (kind: listing)
 *   "where is registerRoute used?"    → the matches   (kind: search)
 *   "what's in package.json?"         → the content   (kind: file)
 *   "what did that GET return?"       → the response  (kind: fetch)
 *
 * Injected into the agent (skill bundle / CLAUDE.md), these replace the
 * exploration prelude: the agent READS the fact instead of re-running the
 * lookup — fewer greps, faster context. `worthIt` is the honest gate: a KG is
 * only emitted when stable facts actually cover a meaningful share of the
 * agent's exploration traffic.
 */

import { createHash } from 'node:crypto';
import type { ClusterAnalysis, NodeAnalysis } from './determinism.ts';

export type KnowledgeKind = 'file' | 'search' | 'listing' | 'fetch' | 'value';

export interface KnowledgeEntry {
  /** Stable across windows: hash(agent | canonical question). */
  id: string;
  kind: KnowledgeKind;
  tool: string;
  /** The question the agent keeps asking (tool arguments). */
  key: string;
  /** The stable answer (already redacted at ingest; truncated for transport). */
  value: string;
  /** Runs that asked this question. */
  support: number;
  /** Share of those runs that got the modal answer (0–1). */
  agreement: number;
  /** Wilson lower bound of the answer's stability, 0–100. */
  confidence: number;
  /** Measured cost of asking, per run (question + answer steps). */
  estUsdPerRun: number;
  agentId: string;
  evidenceRunIds: string[];
}

export interface KnowledgeGraphReport {
  agentId: string;
  runCount: number;
  entries: KnowledgeEntry[];
  /** Support-weighted count of mechanical/cacheable lookups in the window. */
  explorationSteps: number;
  /** Of those, how many a KG fact now answers. */
  coveredSteps: number;
  /** coveredSteps ÷ explorationSteps — the "fewer greps" measure. */
  coverage: number;
  /** Σ entry cost — what reading facts instead would remove, per run. */
  estUsdPerRun: number;
  /** Emit/inject only when the graph actually pays for its context space. */
  worthIt: boolean;
}

export interface KnowledgeOptions {
  /** Result-value agreement required to call an answer stable (0–100). */
  minScore?: number;
  /** Wilson confidence floor (0–100). */
  minConfidence?: number;
  /** worthIt gates. */
  minEntries?: number;
  minCoverage?: number;
  /** Truncation for stored answers. */
  maxValueChars?: number;
  maxEntries?: number;
}

const BASH_SEARCH = /^\s*(grep|rg|ag)\b/;
const BASH_LISTING = /^\s*(ls|find|tree|glob)\b/;
const BASH_FILE = /^\s*(cat|head|tail|less)\b/;

function kindOf(tool: string, rawArgs: string): KnowledgeKind {
  const t = tool.toLowerCase();
  if (t === 'read' || t === 'notebookread') return 'file';
  if (t === 'grep') return 'search';
  if (t === 'glob' || t === 'ls') return 'listing';
  if (t.includes('fetch') || t.includes('search') && t.startsWith('web')) return 'fetch';
  if (t === 'websearch' || t === 'web_search' || t === 'webfetch' || t === 'web_fetch') return 'fetch';
  if (t === 'bash' || t === 'shell') {
    try {
      const cmd = (JSON.parse(rawArgs) as { command?: string }).command ?? '';
      if (BASH_SEARCH.test(cmd)) return 'search';
      if (BASH_LISTING.test(cmd)) return 'listing';
      if (BASH_FILE.test(cmd)) return 'file';
    } catch {
      /* raw payload */
    }
  }
  return 'value';
}

function toolNameOf(structLabel: string): string {
  return structLabel.startsWith('tool:') ? structLabel.slice(5).split('(')[0] : structLabel;
}

/** Build per-agent knowledge graphs from analyzed clusters (same input as
 *  synthesis — callers already have `analyzeDeterminism` output). */
export function buildKnowledgeGraph(
  analyses: ClusterAnalysis[],
  opts: KnowledgeOptions = {},
): KnowledgeGraphReport[] {
  const minScore = opts.minScore ?? 90;
  const minConfidence = opts.minConfidence ?? 50;
  const minEntries = opts.minEntries ?? 3;
  const minCoverage = opts.minCoverage ?? 0.2;
  const maxValueChars = opts.maxValueChars ?? 600;
  const maxEntries = opts.maxEntries ?? 40;

  const byAgent = new Map<string, ClusterAnalysis[]>();
  for (const a of analyses) {
    (byAgent.get(a.agentId) ?? byAgent.set(a.agentId, []).get(a.agentId)!).push(a);
  }

  const reports: KnowledgeGraphReport[] = [];
  for (const [agentId, agentAnalyses] of byAgent) {
    const merged = new Map<string, KnowledgeEntry>();
    let exploration = 0;
    let covered = 0;
    let runCount = 0;

    for (const analysis of agentAnalyses) {
      runCount += analysis.runCount;
      const medoid = analysis.alignment.cluster.medoid;
      const nodes = analysis.nodes;

      for (let i = 0; i < nodes.length; i++) {
        const use: NodeAnalysis = nodes[i];
        if (use.kind !== 'tool_use') continue;
        if (!(use.class === 'mechanical' || use.class === 'cacheable')) continue;
        exploration += use.support;

        const res = nodes[i + 1];
        if (!res || res.kind !== 'tool_result') continue;
        // A fact needs BOTH a stable question and a stable answer.
        if (use.score < minScore || res.score < minScore) continue;
        if (res.confidence < minConfidence) continue;

        covered += use.support;
        const tool = toolNameOf(use.structLabel);
        const keyRaw = medoid.nodes[use.index]?.raw ?? '';
        const id = createHash('sha256')
          .update(`${agentId}|kg|${use.label}`)
          .digest('hex')
          .slice(0, 12);
        const entry: KnowledgeEntry = {
          id,
          kind: kindOf(tool, keyRaw),
          tool,
          key: keyRaw.slice(0, 300),
          value: (medoid.nodes[res.index]?.raw ?? '').slice(0, maxValueChars),
          support: use.support,
          agreement: Math.round((res.score / 100) * 100) / 100,
          confidence: res.confidence,
          estUsdPerRun: Math.round((use.estUsdPerRun + res.estUsdPerRun) * 10000) / 10000,
          agentId,
          evidenceRunIds: analysis.runIds.slice(0, 5),
        };
        const prev = merged.get(id);
        if (prev) {
          // Clusters partition runs, so supports add; keep the stronger answer.
          prev.support += entry.support;
          prev.agreement = Math.max(prev.agreement, entry.agreement);
          prev.confidence = Math.min(prev.confidence, entry.confidence);
          prev.estUsdPerRun = Math.round(((prev.estUsdPerRun + entry.estUsdPerRun) / 2) * 10000) / 10000;
          prev.evidenceRunIds = [...new Set([...prev.evidenceRunIds, ...entry.evidenceRunIds])].slice(0, 5);
        } else {
          merged.set(id, entry);
        }
      }
    }

    const entries = [...merged.values()]
      .sort((a, b) => b.support * b.estUsdPerRun - a.support * a.estUsdPerRun || b.support - a.support)
      .slice(0, maxEntries);
    const coverage = exploration === 0 ? 0 : covered / exploration;
    reports.push({
      agentId,
      runCount,
      entries,
      explorationSteps: exploration,
      coveredSteps: covered,
      coverage: Math.round(coverage * 100) / 100,
      estUsdPerRun: Math.round(entries.reduce((s, e) => s + e.estUsdPerRun, 0) * 10000) / 10000,
      worthIt: entries.length >= minEntries && coverage >= minCoverage,
    });
  }

  return reports.sort((a, b) => b.estUsdPerRun - a.estUsdPerRun);
}
