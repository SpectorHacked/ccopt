/**
 * Demo: synthesize a month of programmatic agent runs (the target-buyer shape:
 * CI/cron agents repeating procedures on different data) and render the Waste
 * Report they would receive. Output: demo-report.html / demo-report.json.
 *
 *   node scripts/demo.mjs
 */

import { writeFileSync } from 'node:fs';
import { parseTranscript, analyzeRuns, renderReportHtml } from '@effigent/core';

function transcript({ sessionId, cwd, prompt, tools, finalText, model, startedAt, inputTokens = 6000, outputTokens = 400 }) {
  const lines = [];
  let seq = 0;
  const ts = () => new Date(Date.parse(startedAt) + seq++ * 30000).toISOString();
  lines.push({ type: 'user', sessionId, uuid: `u-${sessionId}`, timestamp: ts(), cwd, message: { role: 'user', content: prompt } });
  tools.forEach((tool, i) => {
    const id = `toolu_${sessionId}_${i}`;
    lines.push({
      type: 'assistant', sessionId, uuid: `a-${sessionId}-${i}`, requestId: `req_${sessionId}_${i}`, timestamp: ts(), cwd,
      message: { role: 'assistant', model, usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: 800, cache_read_input_tokens: 1200 }, content: [{ type: 'tool_use', id, name: tool.name, input: tool.input }] },
    });
    lines.push({
      type: 'user', sessionId, uuid: `u-${sessionId}-${i}`, timestamp: ts(), cwd,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: tool.result }], ...(tool.isError ? { is_error: true } : {}) }] },
    });
  });
  lines.push({
    type: 'assistant', sessionId, uuid: `a-${sessionId}-f`, requestId: `req_${sessionId}_f`, timestamp: ts(), cwd,
    message: { role: 'assistant', model, usage: { input_tokens: inputTokens, output_tokens: outputTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 1200 }, content: [{ type: 'text', text: finalText }] },
  });
  return lines.map((l) => JSON.stringify(l)).join('\n');
}

const runs = [];
const day = (i) => `2026-06-${String((i % 28) + 1).padStart(2, '0')}T03:15:00.000Z`;

// 1. Nightly product-feed scraper — highly deterministic, big model → compile + rightsize evidence.
for (let i = 0; i < 28; i++) {
  const model = i % 3 === 0 ? 'claude-haiku-4-5-20251001' : 'claude-opus-4-8';
  runs.push(parseTranscript(transcript({
    sessionId: `feed-${i}`, cwd: '/srv/agents/feed-sync', model, startedAt: day(i),
    prompt: `Sync the product feed for store ${100 + i}: fetch https://api.shop.example.com/stores/${100 + i}/products, normalize, and upsert into the catalog DB.`,
    tools: [
      { name: 'WebFetch', input: { url: `https://api.shop.example.com/stores/${100 + i}/products` }, result: `{"items": ${140 + i}, "cursor": "c_${i}9f3a2b1"}` },
      { name: 'Bash', input: { command: `python normalize.py --store ${100 + i} --out /tmp/feed_${i}.json` }, result: `normalized ${140 + i} products` },
      { name: 'Bash', input: { command: `python upsert.py --in /tmp/feed_${i}.json` }, result: `upserted ${140 + i} rows` },
    ],
    finalText: `Feed sync complete for store ${100 + i}: ${140 + i} products upserted.`,
  }), { agentId: 'feed-sync' }));
}

// 2. Hourly status summarizer — literally identical input re-run → cache finding.
for (let i = 0; i < 9; i++) {
  runs.push(parseTranscript(transcript({
    sessionId: `status-${i}`, cwd: '/srv/agents/statusbot', model: 'claude-sonnet-5', startedAt: day(i),
    prompt: 'Summarize the current runbook at /srv/runbooks/oncall.md into a Slack-ready digest.',
    tools: [{ name: 'Read', input: { file_path: '/srv/runbooks/oncall.md' }, result: '# Oncall runbook v7 (stable content)' }],
    finalText: 'Digest: oncall runbook v7 — 4 services, 2 escalation paths, no changes.',
  }), { agentId: 'statusbot' }));
}

// 3. Flaky deploy agent — retry motifs → fix finding.
for (let i = 0; i < 8; i++) {
  runs.push(parseTranscript(transcript({
    sessionId: `deploy-${i}`, cwd: '/srv/agents/deployer', model: 'claude-sonnet-5', startedAt: day(i + 3),
    prompt: `Deploy release 2.4.${i} to staging and verify health.`,
    tools: [
      { name: 'Bash', input: { command: `helm upgrade app ./chart --set tag=2.4.${i}` }, result: 'Error: connection reset by peer', isError: true },
      { name: 'Bash', input: { command: `helm upgrade app ./chart --set tag=2.4.${i}` }, result: 'Error: connection reset by peer', isError: true },
      { name: 'Bash', input: { command: `helm upgrade app ./chart --set tag=2.4.${i}` }, result: `Release "app" upgraded to 2.4.${i}` },
      { name: 'Bash', input: { command: 'curl -sf https://staging.example.com/healthz' }, result: '{"ok":true}' },
    ],
    finalText: `Deployed 2.4.${i} to staging after retries; health check green.`,
  }), { agentId: 'deployer' }));
}

const valid = runs.filter(Boolean);
const { report } = analyzeRuns(valid, '2026-07-01T00:00:00.000Z');
writeFileSync(new URL('../demo-report.html', import.meta.url), renderReportHtml(report, { title: 'effigent demo — Agent Waste Report' }));
writeFileSync(new URL('../demo-report.json', import.meta.url), JSON.stringify(report, null, 2));

console.log(`Demo: ${report.totals.runs} runs, $${report.totals.costUsd} observed (~$${report.totals.estMonthlyCostUsd}/mo), ${Math.round(report.totals.clusteredRunRatio * 100)}% clustered`);
for (const [i, f] of report.findings.entries()) {
  console.log(`  #${i + 1} [${f.kind}] $${f.estMonthlySavingUsd}/mo — ${f.title}`);
}
console.log('Wrote demo-report.html');
