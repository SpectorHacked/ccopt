import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../src/transcript.js';
import { buildRunGraph } from '../src/graph.js';
import { clusterRuns } from '../src/cluster.js';
import { analyzeRuns } from '../src/analyze.js';
import { renderReportHtml } from '../src/report.js';
import { scrapeRun, synthTranscript } from './helpers.js';

function graphOf(jsonl: string) {
  const run = parseTranscript(jsonl);
  expect(run).not.toBeNull();
  return buildRunGraph(run!);
}

describe('transcript parsing', () => {
  it('extracts steps, usage, cost, prompts', () => {
    const run = parseTranscript(scrapeRun(1))!;
    expect(run.runId).toBe('scrape-1');
    expect(run.agentId).toBe('scraper');
    expect(run.steps.filter((s) => s.kind === 'tool_use')).toHaveLength(3);
    expect(run.steps.filter((s) => s.kind === 'tool_result')).toHaveLength(3);
    expect(run.costUsd).toBeGreaterThan(0);
    expect(run.firstPrompt).toContain('Scrape');
    expect(run.finalOutput).toContain('Done.');
  });

  it('returns null for sessions with no assistant activity', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      sessionId: 'x',
      message: { role: 'user', content: 'hello' },
    });
    expect(parseTranscript(jsonl)).toBeNull();
  });

  it('tolerates corrupt lines', () => {
    const run = parseTranscript('not-json\n' + scrapeRun(2));
    expect(run).not.toBeNull();
  });
});

describe('fingerprints', () => {
  it('L1 equal for same procedure with different data; L0 differs', () => {
    const a = graphOf(scrapeRun(1));
    const b = graphOf(scrapeRun(2));
    expect(a.l1).toBe(b.l1);
    expect(a.l0).not.toBe(b.l0);
  });

  it('L0 equal for literally identical runs', () => {
    const a = graphOf(scrapeRun(7));
    const b = graphOf(scrapeRun(7, { sessionId: 'scrape-7-dup' }));
    expect(a.l0).toBe(b.l0);
  });

  it('different procedure → different L1', () => {
    const a = graphOf(scrapeRun(1));
    const b = graphOf(
      synthTranscript({
        sessionId: 'other-1',
        prompt: 'Summarize the README',
        tools: [{ name: 'Read', input: { file_path: '/repo/README.md' }, result: '# Readme' }],
        finalText: 'Summary: a readme.',
      }),
    );
    expect(a.l1).not.toBe(b.l1);
  });

  it('dataflow edges connect outputs to later inputs', () => {
    const g = graphOf(scrapeRun(3));
    expect(g.edges.some((e) => e.type === 'dataflow')).toBe(true);
  });
});

describe('clustering & metrics', () => {
  const runs = [
    ...Array.from({ length: 12 }, (_, i) => parseTranscript(scrapeRun(i + 1))!),
    parseTranscript(
      synthTranscript({
        sessionId: 'one-off',
        prompt: 'Refactor the auth module',
        tools: [{ name: 'Read', input: { file_path: '/repo/auth.ts' }, result: 'code' }],
        finalText: 'Refactored.',
      }),
    )!,
  ];

  it('groups same-procedure runs into one L1 cluster', () => {
    const clusters = clusterRuns(runs.map(buildRunGraph));
    const big = clusters.find((c) => c.metrics.nRuns === 12);
    expect(big).toBeDefined();
    expect(big!.metrics.determinismScore).toBeGreaterThan(0.8);
    expect(big!.metrics.volatileSlots.length).toBeGreaterThan(0);
    expect(big!.metrics.failureRate).toBe(0);
  });

  it('counts L0 duplicates', () => {
    const dups = Array.from({ length: 6 }, (_, i) =>
      parseTranscript(scrapeRun(99, { sessionId: `dup-${i}` }))!,
    );
    const clusters = clusterRuns(dups.map(buildRunGraph));
    expect(clusters[0].metrics.l0DuplicateRuns).toBe(5);
    expect(clusters[0].metrics.l0DuplicateCostUsd).toBeGreaterThan(0);
  });
});

describe('findings & report', () => {
  it('emits a compile finding for a deterministic cluster ≥10 runs', () => {
    const runs = Array.from({ length: 12 }, (_, i) => parseTranscript(scrapeRun(i + 1))!);
    const { report } = analyzeRuns(runs, '2026-07-05T12:00:00.000Z');
    const compile = report.findings.find((f) => f.kind === 'compile');
    expect(compile).toBeDefined();
    expect(compile!.estMonthlySavingUsd).toBeGreaterThan(0);
    expect(report.findings.length).toBeLessThanOrEqual(5);
  });

  it('emits a cache finding for L0 duplicates ≥5', () => {
    const runs = Array.from({ length: 7 }, (_, i) =>
      parseTranscript(scrapeRun(42, { sessionId: `dup-${i}` }))!,
    );
    const { report } = analyzeRuns(runs, '2026-07-05T12:00:00.000Z');
    expect(report.findings.some((f) => f.kind === 'cache')).toBe(true);
  });

  it('emits a rightsize finding when a cheap model matches the big model', () => {
    const big = Array.from({ length: 5 }, (_, i) =>
      parseTranscript(scrapeRun(i + 1, { sessionId: `big-${i}`, model: 'claude-opus-4-8' }))!,
    );
    const cheap = Array.from({ length: 5 }, (_, i) =>
      parseTranscript(scrapeRun(i + 20, { sessionId: `cheap-${i}`, model: 'claude-haiku-4-5-20251001' }))!,
    );
    const { report } = analyzeRuns([...big, ...cheap], '2026-07-05T12:00:00.000Z');
    const rs = report.findings.find((f) => f.kind === 'rightsize');
    expect(rs).toBeDefined();
    expect(rs!.details.cheapModel).toContain('haiku');
  });

  it('emits a fix finding for retry-heavy clusters', () => {
    const runs = Array.from({ length: 6 }, (_, i) =>
      parseTranscript(
        synthTranscript({
          sessionId: `flaky-${i}`,
          prompt: `Deploy build ${i} to staging`,
          tools: [
            { name: 'Bash', input: { command: `deploy --build ${i}` }, result: 'connection reset', isError: true },
            { name: 'Bash', input: { command: `deploy --build ${i}` }, result: 'connection reset', isError: true },
            { name: 'Bash', input: { command: `deploy --build ${i}` }, result: 'deployed ok' },
          ],
          finalText: `Deployed build ${i} after retries.`,
        }),
      )!,
    );
    const { report } = analyzeRuns(runs, '2026-07-05T12:00:00.000Z');
    expect(report.findings.some((f) => f.kind === 'fix')).toBe(true);
  });

  it('renders self-contained HTML with SVG chains', () => {
    const runs = Array.from({ length: 12 }, (_, i) => parseTranscript(scrapeRun(i + 1))!);
    const { report } = analyzeRuns(runs, '2026-07-05T12:00:00.000Z');
    const html = renderReportHtml(report);
    expect(html).toContain('<svg');
    expect(html).toContain('The Agent Waste Report');
    expect(html).toContain('COMPILE IT');
  });
});
