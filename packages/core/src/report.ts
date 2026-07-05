/**
 * The Waste Report renderer — self-contained HTML (inline CSS, inline SVG
 * chains), plus the JSON artifact. Used by `ccopt analyze` locally and by the
 * hosted report viewer.
 */

import type { Finding, WasteReport } from './types.js';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function usd(n: number): string {
  return n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`;
}

const KIND_META: Record<Finding['kind'], { badge: string; color: string }> = {
  compile: { badge: 'COMPILE IT', color: '#7c5cff' },
  cache: { badge: 'CACHE IT', color: '#00a37a' },
  rightsize: { badge: 'RIGHT-SIZE IT', color: '#0b84ff' },
  fix: { badge: 'FIX IT', color: '#e5484d' },
  precompute: { badge: 'PRECOMPUTE IT', color: '#f5a623' },
  align: { badge: 'ALIGN IT', color: '#8f8f8f' },
};

/** Simple SVG chain: one box per canonical step, arrows between. */
export function chainSvg(labels: string[]): string {
  if (labels.length === 0) return '';
  const BOX_W = 170;
  const BOX_H = 44;
  const GAP = 28;
  const PAD = 8;
  const width = labels.length * (BOX_W + GAP) - GAP + PAD * 2;
  const height = BOX_H + PAD * 2;
  const parts: string[] = [];
  labels.forEach((label, i) => {
    const x = PAD + i * (BOX_W + GAP);
    const y = PAD;
    const isTool = label.startsWith('tool:');
    const isResult = label.startsWith('result:');
    const isErr = / error /.test(label) || label.includes(' error');
    const fill = isErr ? '#fdecec' : isTool ? '#eef2ff' : isResult ? '#f0faf5' : '#f7f7f8';
    const stroke = isErr ? '#e5484d' : isTool ? '#7c5cff' : isResult ? '#00a37a' : '#c9c9cf';
    const text = label.length > 40 ? `${label.slice(0, 39)}…` : label;
    parts.push(
      `<g><rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>` +
        `<text x="${x + BOX_W / 2}" y="${y + BOX_H / 2 + 4}" font-size="10" font-family="ui-monospace,Menlo,monospace" text-anchor="middle" fill="#333">${esc(text)}</text></g>`,
    );
    if (i < labels.length - 1) {
      const ax = x + BOX_W;
      const ay = y + BOX_H / 2;
      parts.push(
        `<line x1="${ax + 3}" y1="${ay}" x2="${ax + GAP - 8}" y2="${ay}" stroke="#9a9aa2" stroke-width="1.5"/>` +
          `<path d="M ${ax + GAP - 8} ${ay - 4} L ${ax + GAP - 1} ${ay} L ${ax + GAP - 8} ${ay + 4} Z" fill="#9a9aa2"/>`,
      );
    }
  });
  return `<div style="overflow-x:auto"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg></div>`;
}

function findingCard(f: Finding, rank: number): string {
  const meta = KIND_META[f.kind];
  return `
  <section class="finding">
    <div class="finding-head">
      <span class="rank">#${rank}</span>
      <span class="badge" style="background:${meta.color}">${meta.badge}</span>
      <span class="saving">${usd(f.estMonthlySavingUsd)}<small>/mo est.</small></span>
    </div>
    <h3>${esc(f.title)}</h3>
    <p class="rec">${esc(f.recommendation)}</p>
    ${f.labelSequence.length ? chainSvg(f.labelSequence) : ''}
    <div class="meta-row">
      <span>agent: <code>${esc(f.agentId)}</code></span>
      <span>confidence: ${(f.confidence * 100).toFixed(0)}%</span>
      <span>effort: ${'●'.repeat(f.effort)}${'○'.repeat(Math.max(0, 5 - f.effort))}</span>
    </div>
    <details>
      <summary>Evidence — ${f.evidenceRunIds.length} run(s)</summary>
      <ul class="evidence">${f.evidenceRunIds.map((id) => `<li><code>${esc(id)}</code></li>`).join('')}</ul>
    </details>
  </section>`;
}

export function renderReportHtml(report: WasteReport, opts: { title?: string } = {}): string {
  const title = opts.title ?? 'ccopt — Agent Waste Report';
  const t = report.totals;
  const topClusters = report.clusters.filter((c) => c.nRuns >= 2).slice(0, 12);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #1a1a1e; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
  header h1 { font-size: 26px; margin: 0 0 4px; }
  header .sub { color: #66666e; margin-bottom: 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 20px 0 32px; }
  .stat { background: #fff; border: 1px solid #e4e4e8; border-radius: 10px; padding: 14px 16px; }
  .stat .v { font-size: 22px; font-weight: 700; }
  .stat .k { font-size: 12px; color: #66666e; text-transform: uppercase; letter-spacing: .04em; }
  .finding { background: #fff; border: 1px solid #e4e4e8; border-radius: 12px; padding: 18px 20px; margin-bottom: 18px; }
  .finding-head { display: flex; align-items: center; gap: 10px; }
  .rank { font-weight: 800; color: #9a9aa2; }
  .badge { color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .05em; padding: 3px 8px; border-radius: 6px; }
  .saving { margin-left: auto; font-size: 20px; font-weight: 800; color: #00794f; }
  .saving small { font-size: 11px; font-weight: 500; color: #66666e; }
  .finding h3 { margin: 10px 0 6px; font-size: 16px; }
  .rec { color: #3c3c44; font-size: 14px; line-height: 1.5; }
  .meta-row { display: flex; gap: 18px; font-size: 12px; color: #66666e; margin-top: 10px; flex-wrap: wrap; }
  details { margin-top: 10px; font-size: 13px; }
  summary { cursor: pointer; color: #55555e; }
  .evidence { columns: 2; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e4e4e8; border-radius: 12px; overflow: hidden; font-size: 13px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #eee; }
  th { background: #f4f4f6; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #66666e; }
  td code { font-size: 11px; }
  .honesty { margin-top: 40px; padding: 16px 18px; background: #fff8e8; border: 1px solid #eedc9a; border-radius: 10px; font-size: 13px; color: #5c4d1e; line-height: 1.5; }
  h2 { margin: 36px 0 14px; font-size: 18px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>The Agent Waste Report</h1>
    <div class="sub">Generated ${esc(report.generatedAt)} · window ${report.windowDays} day(s) · agents: ${report.agentIds.map((a) => `<code>${esc(a)}</code>`).join(', ')}</div>
  </header>

  <div class="stats">
    <div class="stat"><div class="v">${report.totals.runs}</div><div class="k">runs analyzed</div></div>
    <div class="stat"><div class="v">${usd(t.costUsd)}</div><div class="k">observed spend</div></div>
    <div class="stat"><div class="v">${usd(t.estMonthlyCostUsd)}</div><div class="k">est. monthly spend</div></div>
    <div class="stat"><div class="v">${(t.clusteredRunRatio * 100).toFixed(0)}%</div><div class="k">runs in repeated shapes</div></div>
    <div class="stat"><div class="v">${(t.cacheReadRatio * 100).toFixed(0)}%</div><div class="k">prompt-cache read ratio</div></div>
  </div>

  <h2>Top findings (ranked by saving × confidence ÷ effort)</h2>
  ${
    report.findings.length
      ? report.findings.map((f, i) => findingCard(f, i + 1)).join('\n')
      : '<p>No findings above threshold yet — keep collecting runs, or lower thresholds with more history.</p>'
  }

  <h2>Repeated procedure clusters</h2>
  <div style="overflow-x:auto">
  <table>
    <thead><tr><th>cluster</th><th>agent</th><th>runs</th><th>cost</th><th>determinism</th><th>failure</th><th>models</th></tr></thead>
    <tbody>
      ${topClusters
        .map(
          (c) =>
            `<tr><td><code>${esc(c.clusterId.slice(0, 28))}</code></td><td>${esc(c.agentId)}</td><td>${c.nRuns}</td><td>${usd(c.totalCostUsd)}</td><td>${(c.determinismScore * 100).toFixed(0)}%</td><td>${(c.failureRate * 100).toFixed(0)}%</td><td>${Object.keys(c.modelMix)
              .map((m) => esc(m.replace(/^claude-/, '')))
              .join(', ')}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>
  </div>

  <div class="honesty">
    <strong>What this report can and can't prove.</strong> It proves <em>procedural repetition</em> —
    the same canonical shape, N times — and prices it precisely from recorded token usage. It cannot
    prove a future run will stay deterministic; determinism is shown as a score, not a promise, and any
    compiled replacement should ship with replay validation and a rollback path.
  </div>
</div>
</body>
</html>`;
}
