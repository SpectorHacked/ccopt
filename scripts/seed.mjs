/**
 * Seed harness — pushes realistic, repeated sample sessions through the ingest
 * API so the brain has clusters to analyze, then reads back the stored DAGs and
 * runs determinism scoring end-to-end.
 *
 *   node scripts/seed.mjs [serverUrl] [adminToken]
 *
 * Defaults to the local stack (http://localhost:8788 / testadmintoken).
 */
import { gzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { scoreDeterminism } from '@ccopt/core';

const SERVER = (process.argv[2] || process.env.CCOPT_SERVER || 'http://localhost:8788').replace(/\/$/, '');
const ADMIN = process.argv[3] || process.env.CCOPT_ADMIN_TOKEN || 'testadmintoken';
const ts = (n) => new Date(1783600000000 + n * 1000).toISOString();

let line = 0;
function L(obj) { return JSON.stringify(obj); }

/** Render one Claude-Code-style transcript (JSONL) from a step spec. */
function transcript(sessionId, steps) {
  const out = [];
  for (const s of steps) {
    line++;
    if (s.k === 'user') {
      out.push(L({ type: 'user', sessionId, timestamp: ts(line), cwd: '/repo', message: { role: 'user', content: s.text } }));
    } else if (s.k === 'assistant') {
      const content = [{ type: 'text', text: s.text }];
      if (s.tool) content.push({ type: 'tool_use', id: s.tool.id, name: s.tool.name, input: s.tool.input });
      out.push(L({
        type: 'assistant', sessionId, requestId: randomUUID(), timestamp: ts(line),
        message: { role: 'assistant', model: 'claude-sonnet-5', content,
          usage: { input_tokens: 1200, output_tokens: 120, cache_read_input_tokens: 400, cache_creation_input_tokens: 0 } },
      }));
    } else if (s.k === 'tool_result') {
      out.push(L({ type: 'user', sessionId, timestamp: ts(line),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: s.id, content: s.text }] } }));
    }
  }
  return out.join('\n') + '\n';
}

/** Two agent shapes, repeated with variance so clusters + per-node scores emerge. */
function invoiceRun(i) {
  const t1 = randomUUID(), t2 = randomUUID();
  // tax result is STABLE (deterministic); PO differs but is data-shaped; ~1/4 of runs get a different tax word.
  const tax = i % 4 === 0 ? 'RATE_ALT_VALUE' : 'RATE_STD_VALUE';
  return [
    { k: 'user', text: `Reconcile invoice INV-${8000 + i} against its purchase order.` },
    { k: 'assistant', text: 'Fetching the purchase order.', tool: { id: t1, name: 'get_purchase_order', input: { po: 'PO-40021' } } },
    { k: 'tool_result', id: t1, text: 'terms=NET30 total=LINEITEMSDATA' },
    { k: 'assistant', text: 'Now the tax rate.', tool: { id: t2, name: 'get_tax_rate', input: { state: 'CA' } } },
    { k: 'tool_result', id: t2, text: tax },
    { k: 'assistant', text: 'Reconciled within tolerance.' },
  ];
}
function supportRun(i) {
  const t1 = randomUUID();
  const tier = i % 5 === 0 ? 'TIER_STARTUP' : 'TIER_ENTERPRISE';
  return [
    { k: 'user', text: `Triage support ticket number ${5500 + i}.` },
    { k: 'assistant', text: 'Looking up the customer tier.', tool: { id: t1, name: 'lookup_customer_tier', input: { account: 'acme' } } },
    { k: 'tool_result', id: t1, text: tier },
    { k: 'assistant', text: 'Assigned priority tier.' },
  ];
}

async function main() {
  console.log(`Seeding ${SERVER} …`);
  const t = await (await fetch(`${SERVER}/api/v1/tenants`, {
    method: 'POST', headers: { 'x-admin-token': ADMIN, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'seed-demo' }),
  })).json();
  const key = t.apiKey;
  console.log(`tenant ${t.tenantId}`);

  const jobs = [];
  for (let i = 0; i < 16; i++) jobs.push(['invoice-reconciliation', `inv-${i}`, invoiceRun(i)]);
  for (let i = 0; i < 14; i++) jobs.push(['support-triage', `sup-${i}`, supportRun(i)]);

  const bySession = {};
  for (const [agent, sid, steps] of jobs) {
    bySession[sid] = agent;
    const body = gzipSync(Buffer.from(transcript(sid, steps)));
    const r = await fetch(`${SERVER}/api/v1/ingest`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'x-ccopt-session-id': sid, 'x-ccopt-agent-id': agent },
      body,
    });
    if (!r.ok) console.error(`  ingest ${sid} failed: ${r.status} ${await r.text()}`);
  }
  console.log(`ingested ${jobs.length} sessions`);

  // Read back the stored DAGs and run the brain.
  const graphs = [];
  for (const sid of Object.keys(bySession)) {
    const g = await fetch(`${SERVER}/api/v1/runs/${encodeURIComponent(sid)}/graph`, { headers: { authorization: `Bearer ${key}` } });
    if (g.ok) graphs.push(await g.json());
  }
  console.log(`fetched ${graphs.length} DAGs\n`);

  const det = scoreDeterminism(graphs, { minRuns: 3 });
  for (const c of det) {
    console.log(`cluster ${c.l1.slice(0, 8)}  agent=${c.agentId}  runs=${c.runCount}  meanScore=${c.meanScore}`);
    for (const n of c.nodes) {
      console.log(`  [${n.index}] ${n.kind.padEnd(11)} score=${String(n.score).padStart(3)} distinct=${n.distinctValues} -> ${n.action}  "${n.label.slice(0, 40)}"`);
    }
    console.log('');
  }
  console.log(`tenant key for further testing: ${key}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
