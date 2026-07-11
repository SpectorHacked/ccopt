/**
 * The insights agent — an LLM goes over ALL runs of a tenant's agent (not just
 * cluster statistics) and produces actionable bullets on how to make the agent
 * cost less WITHOUT hurting performance.
 *
 * Per run it sees a digest built from the canonical graph: which tools ran,
 * which files/folders/repos were read, which domains were web-fetched, which
 * commands were executed, prompt sizes, token/cache economics, dataflow and
 * error structure. Every digest links to that run's graph (/g/:sessionId).
 *
 * The engine's clusters (determinism scores, volatile slots) ride along as the
 * safety data: deterministic segments are where scripts/smaller models are safe.
 *
 * Provider-agnostic: uses the LlmProvider abstraction (Anthropic by default,
 * any OpenAI-compatible endpoint via env). See llm.ts.
 */

import { buildRunGraph, mineSegments, toolProfile, type MinedSegment, type Run, type RunGraph, type WasteReport } from '@effigent/core';
import type { LlmProvider } from './llm.js';

// ─── Per-run digest ───────────────────────────────────────────────────────────

export interface RunDigest {
  sessionId: string;
  graphUrl: string;
  agentId: string;
  costUsd: number;
  models: string[];
  nSteps: number;
  dataflowEdges: number;
  errorSteps: number;
  tokenUsage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cacheReadRatio: number;
  toolCounts: Record<string, number>;
  /** Taxonomy profile: how much of this run needs no intelligence. */
  toolClassProfile: { mechanical: number; cacheable: number; generative: number; sideEffect: number; mechanicalRatio: number };
  /** Semantic signals: what the agent actually spent its steps on. */
  signals: {
    filesRead: string[];
    foldersListed: string[];
    webFetched: string[];
    webSearches: string[];
    bashCommands: string[];
    repoOperations: string[];
  };
  firstPrompt?: string;
  /** Canonical step sequence (truncated) — the run's procedure skeleton. */
  stepSequence: string[];
}

function push(list: string[], value: string, max = 12): void {
  if (value && !list.includes(value) && list.length < max) list.push(value);
}

export function buildRunDigest(run: Run, publicBaseUrl: string, graph?: RunGraph): RunDigest {
  graph = graph ?? buildRunGraph(run);
  const profile = toolProfile(run.steps);
  const toolCounts: Record<string, number> = {};
  const signals: RunDigest['signals'] = {
    filesRead: [],
    foldersListed: [],
    webFetched: [],
    webSearches: [],
    bashCommands: [],
    repoOperations: [],
  };

  for (const step of run.steps) {
    if (step.kind !== 'tool_use') continue;
    toolCounts[step.name] = (toolCounts[step.name] ?? 0) + 1;
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(step.payload) as Record<string, unknown>;
    } catch {
      /* non-JSON input */
    }
    const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
    switch (step.name) {
      case 'Read':
      case 'read':
        push(signals.filesRead, str('file_path') || str('path'));
        break;
      case 'Glob':
      case 'glob':
      case 'LS':
        push(signals.foldersListed, str('path') || str('pattern'));
        break;
      case 'WebFetch':
      case 'web_fetch':
        push(signals.webFetched, str('url'));
        break;
      case 'WebSearch':
      case 'web_search':
        push(signals.webSearches, str('query'));
        break;
      case 'Bash':
      case 'bash': {
        const cmd = str('command');
        push(signals.bashCommands, cmd.slice(0, 100));
        if (/\bgit\b|gh |clone|checkout|\bgrep -r|rg /.test(cmd)) {
          push(signals.repoOperations, cmd.slice(0, 100));
        }
        break;
      }
      case 'Grep':
      case 'grep':
        push(signals.repoOperations, `grep: ${str('pattern')}`.slice(0, 100));
        break;
    }
  }

  const usage = Object.values(run.usageByModel).reduce(
    (acc, u) => ({
      input: acc.input + u.inputTokens,
      output: acc.output + u.outputTokens,
      cacheRead: acc.cacheRead + u.cacheReadInputTokens,
      cacheWrite: acc.cacheWrite + u.cacheCreationInputTokens,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const allInput = usage.input + usage.cacheRead + usage.cacheWrite;

  return {
    sessionId: run.runId,
    graphUrl: `${publicBaseUrl}/g/${run.runId}`,
    agentId: run.agentId,
    costUsd: Math.round(run.costUsd * 100) / 100,
    models: run.models,
    nSteps: run.steps.length,
    dataflowEdges: graph.edges.filter((e) => e.type === 'dataflow').length,
    errorSteps: graph.nodes.filter((n) => n.isError).length,
    tokenUsage: usage,
    cacheReadRatio: allInput === 0 ? 0 : Math.round((usage.cacheRead / allInput) * 100) / 100,
    toolCounts,
    toolClassProfile: {
      mechanical: profile.mechanical,
      cacheable: profile.cacheable,
      generative: profile.generative,
      sideEffect: profile.sideEffect,
      mechanicalRatio: profile.mechanicalRatio,
    },
    signals,
    firstPrompt: run.firstPrompt?.slice(0, 300),
    stepSequence:
      graph.labelSequence.length > 40
        ? [...graph.labelSequence.slice(0, 40).map((l) => l.slice(0, 90)), `… ${graph.labelSequence.length - 40} more`]
        : graph.labelSequence.map((l) => l.slice(0, 90)),
  };
}

// ─── Analysis packet ──────────────────────────────────────────────────────────

export interface InsightsPacketCluster {
  clusterId: string;
  agentId: string;
  nRuns: number;
  totalCostUsd: number;
  determinism: number;
  failureRate: number;
  labelSequence: string[];
  metrics: Record<string, unknown>;
}

export interface InsightsPacket {
  windowDays: number;
  totals: WasteReport['totals'];
  agents: string[];
  runsAnalyzed: number;
  runsTotal: number;
  runs: RunDigest[];
  segments: MinedSegment[];
  clusters: InsightsPacketCluster[];
  engineFindings: { kind: string; title: string; estMonthlySavingUsd: number; recommendation: string }[];
}

export function buildInsightsPacket(
  report: WasteReport,
  clusters: InsightsPacketCluster[],
  digests: RunDigest[],
  runsTotal: number,
  segments: MinedSegment[] = [],
): InsightsPacket {
  return {
    windowDays: report.windowDays,
    totals: report.totals,
    agents: report.agentIds,
    runsAnalyzed: digests.length,
    runsTotal,
    runs: digests,
    segments,
    clusters: clusters
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
      .slice(0, 12)
      .map((c) => ({
        ...c,
        labelSequence:
          c.labelSequence.length > 40
            ? [...c.labelSequence.slice(0, 40), `… ${c.labelSequence.length - 40} more steps`]
            : c.labelSequence,
      })),
    engineFindings: report.findings.map((f) => ({
      kind: f.kind,
      title: f.title,
      estMonthlySavingUsd: f.estMonthlySavingUsd,
      recommendation: f.recommendation,
    })),
  };
}

// ─── LLM analysis ─────────────────────────────────────────────────────────────

export interface Insight {
  title: string;
  action_type: 'add-tool' | 'extract-subagent' | 'compile-script' | 'cache-or-precompute' | 'prompt-change' | 'fix-failure' | 'other';
  category: string;
  est_monthly_saving_usd: number;
  performance_risk: 'none' | 'low' | 'medium' | 'high';
  rationale: string;
  /** add-tool: the concrete tool spec (empty strings when N/A). */
  tool_name: string;
  tool_description: string;
  tool_input_sketch: string;
  tool_replaces: string;
  /** extract-subagent: the delegation contract (empty strings when N/A). */
  subagent_task: string;
  subagent_model: string;
  subagent_inputs: string;
  subagent_outputs: string;
  subagent_splice_point: string;
  /** Numbered, do-this-then-that engineering steps. */
  implementation_steps: string[];
  evidence_runs: string[];
}

export interface InsightsResult {
  summary: string;
  insights: Insight[];
  provider: string;
  model: string;
  generatedAt: string;
  runsAnalyzed: number;
  /** Freshness gate bookkeeping: what the analysis covered. */
  agentFilter: string | null;
  runsTotalAtGeneration: number;
}

// Schema is dual-compatible: Anthropic structured outputs and OpenAI strict
// json_schema both require additionalProperties:false and full `required`.
const INSIGHTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'insights'],
  properties: {
    summary: {
      type: 'string',
      description: 'Executive summary: where this agent wastes money and the single highest-leverage change.',
    },
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'action_type', 'category', 'est_monthly_saving_usd', 'performance_risk', 'rationale',
          'tool_name', 'tool_description', 'tool_input_sketch', 'tool_replaces',
          'subagent_task', 'subagent_model', 'subagent_inputs', 'subagent_outputs', 'subagent_splice_point',
          'implementation_steps', 'evidence_runs',
        ],
        properties: {
          title: { type: 'string' },
          action_type: {
            type: 'string',
            enum: ['add-tool', 'extract-subagent', 'compile-script', 'cache-or-precompute', 'prompt-change', 'fix-failure', 'other'],
          },
          category: { type: 'string', description: 'short kebab-case tag, e.g. knowledge-summary, model-rightsizing' },
          est_monthly_saving_usd: { type: 'number' },
          performance_risk: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
          rationale: { type: 'string' },
          tool_name: { type: 'string', description: 'add-tool only: snake_case tool name, else empty string' },
          tool_description: { type: 'string', description: 'add-tool only: one-line description the LLM will read, else empty' },
          tool_input_sketch: { type: 'string', description: 'add-tool only: JSON-ish input sketch e.g. {"symbol": "string"}, else empty' },
          tool_replaces: { type: 'string', description: 'add-tool only: the exact repeated pattern it replaces, with real names from the runs, else empty' },
          subagent_task: { type: 'string', description: 'extract-subagent only: one-sentence task statement, else empty' },
          subagent_model: { type: 'string', description: 'extract-subagent only: recommended smaller model id, else empty' },
          subagent_inputs: { type: 'string', description: 'extract-subagent only: exactly what crosses INTO the sub-agent, else empty' },
          subagent_outputs: { type: 'string', description: 'extract-subagent only: exactly what it must return, else empty' },
          subagent_splice_point: { type: 'string', description: 'extract-subagent only: which steps/segment it replaces, else empty' },
          implementation_steps: {
            type: 'array',
            items: { type: 'string' },
            description: '3-7 numbered engineering steps, each independently actionable',
          },
          evidence_runs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are Effigent's cost-optimization agent. You receive telemetry for ONE tenant's AI agent: per-run digests (tool calls, files read, folders listed, web fetches/searches, bash commands, prompt sizes, token/cache economics, canonical step sequences, error/dataflow structure), cross-run mined segments, and procedure clusters with determinism scores.

Your output is a set of ENGINEERING TICKETS, not advice. Every insight must be implementable by a developer tomorrow morning without further analysis. Generic suggestions ("use caching", "consider a smaller model") are failures.

The three highest-value ticket types, in order:

1. ADD-TOOL (action_type: add-tool). Hunt for TOOL GAPS: multi-step manual patterns the agent repeats because it lacks a purpose-built tool. Signature: the same shape of grep/read/list/fetch sequence recurring across runs to answer one recurring question. When found, SPECIFY THE TOOL: snake_case name, the one-line description the LLM will read, an input sketch, and the exact pattern it replaces using REAL names from the digests (real files, real grep patterns, real domains). Estimate calls saved per run. A good tool collapses 5-15 steps into 1.

2. EXTRACT-SUBAGENT (action_type: extract-subagent). Find the part that can run on a smaller LLM, using the safety data: segments/step-ranges where determinism is high, mechanicalRatio is high, and separability is "clean" (boundaryInputs/boundaryOutputs ≤ 2 = a clean contract; "entangled" segments must NOT be extracted). Specify the delegation contract: subagent_task (one sentence), subagent_model (claude-haiku-4-5 for mechanical orchestration, claude-sonnet-5 when judgment is needed), subagent_inputs (exactly the values that cross the boundary — derive from boundaryInputs), subagent_outputs (what the parent needs back), subagent_splice_point (the exact steps/segment replaced). The parent keeps the open-ended reasoning; the sub-agent owns the predictable loop.

3. COMPILE-SCRIPT (action_type: compile-script). Segments with determinism ≥ 0.9 AND mechanicalRatio ≥ 0.6 AND clean/moderate separability need no LLM at all: specify the script in implementation_steps (what it reads, what it writes, where the volatile parameters go).

Also allowed when the data demands them: cache-or-precompute (identical re-runs, repeated stable lookups → name the artifact: which file/summary to precompute, keyed on what), prompt-change (oversized/churning prompt prefixes — cite the cacheReadRatio and prompt sizes), fix-failure (error steps and retry motifs — name the failing step).

Rules:
- implementation_steps: 3-7 numbered steps a developer executes verbatim; reference the tenant's actual harness (these agents run on the Claude Agent SDK / Claude Code with MCP tools).
- Derive est_monthly_saving_usd from packet costs, extrapolated by windowDays — say so in the rationale. Never invent spend.
- performance_risk is as important as savings: "none" = mathematically identical output; "high" = could change behavior. Extraction of an "entangled" segment is high risk — do not propose it.
- Every insight cites evidence_runs (sessionIds). Fields that do not apply to the action_type are empty strings.
- Order by est_monthly_saving_usd descending. 3-8 insights. If runsAnalyzed < runsTotal, note the sampling in the summary. If the data cannot support a ticket type, do not fabricate one.`;

export async function generateInsights(
  llm: LlmProvider,
  packet: InsightsPacket,
  agentFilter?: string,
): Promise<InsightsResult> {
  const parsed = (await llm.generateJson({
    system: SYSTEM_PROMPT,
    prompt:
      'Analyze this agent telemetry and produce the cost-reduction bullets.\n\n```json\n' +
      JSON.stringify(packet) +
      '\n```',
    schema: INSIGHTS_SCHEMA,
  })) as { summary: string; insights: Insight[] };

  return {
    summary: parsed.summary,
    insights: parsed.insights,
    provider: llm.name,
    model: llm.model,
    generatedAt: new Date().toISOString(),
    runsAnalyzed: packet.runsAnalyzed,
    agentFilter: agentFilter ?? null,
    runsTotalAtGeneration: packet.runsTotal,
  };
}
