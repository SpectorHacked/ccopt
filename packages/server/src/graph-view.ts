/**
 * Professional run-graph view — horizontal wrapped flow of class-colored step
 * chips, with mined-segment bands marking what can be switched (compiled to a
 * script / routed to a smaller model), and a click-to-explore detail drawer.
 *
 * Palette: validated categorical set (dataviz six-checks, light surface):
 *   mechanical #1baf7a · cacheable #2a78d6 · generative #4a3aa7 · side-effect #eb6834
 *   error = status red #e34948. Identity is never color-alone: every chip carries
 *   a text label and the legend names each class.
 */

import {
  attributeStepCosts,
  classifyNode,
  type MinedSegment,
  type RunGraph,
  type StepClass,
} from '@ccopt/core';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CLASS_META: Record<StepClass, { color: string; tint: string; icon: string; name: string }> = {
  mechanical: { color: '#1baf7a', tint: '#e6f7f0', icon: '⚙', name: 'Mechanical' },
  cacheable: { color: '#2a78d6', tint: '#e8f1fb', icon: '⇩', name: 'Cacheable' },
  generative: { color: '#4a3aa7', tint: '#edeaf8', icon: '✦', name: 'Generative' },
  side_effect: { color: '#eb6834', tint: '#fdeee6', icon: '✎', name: 'Side effect' },
};
const ERROR_COLOR = '#e34948';

export interface SegmentOccurrence {
  start: number;
  length: number;
  determinism: number;
  mechanicalRatio: number;
  support: number;
  runsTotal: number;
  avgCostUsd: number;
  verdict: 'script' | 'smaller-model' | 'repeated';
}

/** Find non-overlapping occurrences of mined segments inside this run. */
export function matchSegments(graph: RunGraph, segments: MinedSegment[]): SegmentOccurrence[] {
  const seq = graph.labelSequence;
  const taken = new Array(seq.length).fill(false);
  const found: SegmentOccurrence[] = [];
  const ranked = [...segments].sort((a, b) => b.totalCostUsd * b.support - a.totalCostUsd * a.support);
  for (const seg of ranked) {
    for (let i = 0; i + seg.labels.length <= seq.length; i++) {
      let ok = true;
      for (let j = 0; j < seg.labels.length; j++) {
        if (seq[i + j] !== seg.labels[j] || taken[i + j]) { ok = false; break; }
      }
      if (!ok) continue;
      for (let j = 0; j < seg.labels.length; j++) taken[i + j] = true;
      found.push({
        start: i,
        length: seg.labels.length,
        determinism: seg.determinism,
        mechanicalRatio: seg.mechanicalRatio,
        support: seg.support,
        runsTotal: seg.runsTotal,
        avgCostUsd: seg.avgCostPerOccurrenceUsd,
        verdict:
          seg.determinism >= 0.9 && seg.mechanicalRatio >= 0.6
            ? 'script'
            : seg.determinism >= 0.7
              ? 'smaller-model'
              : 'repeated',
      });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

const VERDICT_META = {
  script: { label: 'SWITCHABLE — compile to script', color: '#1baf7a' },
  'smaller-model': { label: 'SWITCHABLE — route to smaller model', color: '#4a3aa7' },
  repeated: { label: 'Repeated across runs', color: '#8f8f96' },
} as const;

function shortName(label: string): string {
  if (label.startsWith('tool:')) return label.slice(5).split(' ')[0];
  if (label.startsWith('result:')) return `↳ ${label.slice(7).split(' ')[0]}`;
  if (label === 'thinking') return 'thinking';
  return label.split(':')[0];
}

function hint(label: string): string {
  const body = label.includes(' ') ? label.slice(label.indexOf(' ') + 1) : '';
  return body.replace(/^[a-z_]+=/, '').slice(0, 26);
}

export function renderGraphPage(
  graph: RunGraph,
  segments: MinedSegment[],
  key: string,
  redact: (t: string) => string,
  revealed: boolean,
): string {
  const k = encodeURIComponent(key);
  const costs = attributeStepCosts(graph);
  const classes = graph.nodes.map((n) => classifyNode(n));
  const occurrences = matchSegments(graph, segments);
  const dataflow = graph.edges.filter((e) => e.type === 'dataflow');
  const counts = { mechanical: 0, cacheable: 0, generative: 0, side_effect: 0 };
  for (const c of classes) counts[c]++;
  const headroom = graph.nodes.length
    ? Math.round(((counts.mechanical + counts.cacheable) / graph.nodes.length) * 100)
    : 0;
  const errors = graph.nodes.filter((n) => n.isError).length;
  const segIndexOf = new Array<number>(graph.nodes.length).fill(-1);
  occurrences.forEach((o, i) => {
    for (let j = o.start; j < o.start + o.length; j++) segIndexOf[j] = i;
  });

  // Node payloads for the drawer (redacted unless revealed)
  const nodeData = graph.nodes.map((n, i) => ({
    i,
    label: n.label,
    cls: classes[i],
    err: n.isError,
    cost: Math.round(costs[i] * 10000) / 10000,
    canonical: redact(n.canonicalValue).slice(0, 4000),
    raw: redact(n.raw).slice(0, 4000),
    inflow: dataflow.filter((e) => e.to === i).map((e) => e.from),
    outflow: dataflow.filter((e) => e.from === i).map((e) => e.to),
    seg: segIndexOf[i],
  }));

  // Build the flow: chips grouped into segment bands or standalone
  let flowHtml = '';
  let i = 0;
  const chip = (idx: number): string => {
    const meta = CLASS_META[classes[idx]];
    const n = graph.nodes[idx];
    const border = n.isError ? ERROR_COLOR : meta.color;
    return `<button class="chip" data-i="${idx}" style="--c:${border};--t:${n.isError ? '#fdecec' : meta.tint}"
      title="#${idx} ${esc(n.label.slice(0, 140))}">
      <span class="chip-ic">${n.isError ? '✕' : meta.icon}</span>
      <span class="chip-tx"><b>${esc(shortName(n.label))}</b><i>${esc(hint(n.label))}</i></span>
      <span class="chip-n">${idx}</span>
    </button>`;
  };
  while (i < graph.nodes.length) {
    const segIdx = segIndexOf[i];
    if (segIdx >= 0 && occurrences[segIdx].start === i) {
      const o = occurrences[segIdx];
      const v = VERDICT_META[o.verdict];
      let inner = '';
      for (let j = o.start; j < o.start + o.length; j++) inner += chip(j);
      flowHtml += `<div class="segband" style="--v:${v.color}">
        <div class="seghead">
          <span class="segtag">${esc(v.label)}</span>
          <span class="segmeta">${o.support}/${o.runsTotal} runs · ${(o.determinism * 100).toFixed(0)}% deterministic · ${(o.mechanicalRatio * 100).toFixed(0)}% mechanical · ~$${o.avgCostUsd}/occurrence</span>
        </div>
        <div class="segchips">${inner}</div>
      </div>`;
      i = o.start + o.length;
    } else {
      flowHtml += chip(i);
      i++;
    }
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>run ${esc(graph.runId.slice(0, 8))} — ccopt</title>
<style>
  :root {
    --surface: #fcfcfb; --card: #ffffff; --line: #e7e6e3;
    --ink: #0b0b0b; --ink-2: #52514e; --ink-3: #8f8e8a;
    --accent: #4a3aa7;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--surface); color: var(--ink);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 28px 24px 90px; }
  header h1 { font-size: 19px; margin: 0; font-weight: 650; letter-spacing: -0.01em; }
  header .sub { color: var(--ink-2); font-size: 12.5px; margin-top: 3px; }
  header a { color: var(--accent); text-decoration: none; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 18px 0 6px; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
  .tile .v { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; }
  .tile .k { font-size: 10.5px; color: var(--ink-3); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
  .tile .bar { height: 5px; border-radius: 3px; background: #efeeeb; margin-top: 8px; overflow: hidden; }
  .tile .bar i { display: block; height: 100%; border-radius: 3px; background: #1baf7a; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
    font-size: 12px; color: var(--ink-2); margin: 14px 0 4px; }
  .legend .sw { display: inline-flex; align-items: center; gap: 5px; }
  .legend .dot { width: 10px; height: 10px; border-radius: 3px; }
  .notice { font-size: 12px; border-radius: 8px; padding: 8px 12px; margin: 10px 0 16px;
    background: ${revealed ? '#fdecec' : '#fbf6e9'}; border: 1px solid ${revealed ? '#e34948' : '#e5d9a8'}; }
  .flowcard { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
  .flow { display: flex; flex-wrap: wrap; gap: 8px 6px; align-items: flex-start; }
  .chip { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--c);
    border-left-width: 4px; background: var(--t); border-radius: 8px; padding: 5px 9px 5px 7px;
    cursor: pointer; font: inherit; text-align: left; transition: box-shadow 0.12s, transform 0.12s; }
  .chip:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.12); transform: translateY(-1px); }
  .chip.sel { outline: 2px solid var(--ink); outline-offset: 1px; }
  .chip.flowmark { box-shadow: 0 0 0 2px var(--accent); }
  .chip-ic { font-size: 13px; color: var(--c); }
  .chip-tx { display: flex; flex-direction: column; line-height: 1.15; }
  .chip-tx b { font-size: 12px; font-weight: 640; }
  .chip-tx i { font-style: normal; font-size: 10px; color: var(--ink-3); max-width: 130px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip-n { font-size: 9.5px; color: var(--ink-3); align-self: flex-start; }
  .segband { border: 1.5px solid var(--v); border-radius: 12px; padding: 0 0 8px; background: #fff;
    flex-basis: 100%; }
  .segband .seghead { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center;
    padding: 7px 12px; border-bottom: 1px dashed var(--line); margin-bottom: 8px; }
  .segtag { background: var(--v); color: #fff; font-size: 10px; font-weight: 700;
    letter-spacing: 0.05em; padding: 2.5px 9px; border-radius: 6px; }
  .segmeta { font-size: 11.5px; color: var(--ink-2); }
  .segchips { display: flex; flex-wrap: wrap; gap: 8px 6px; padding: 0 12px; }
  .drawer { position: fixed; right: 0; top: 0; bottom: 0; width: min(480px, 92vw);
    background: var(--card); border-left: 1px solid var(--line); box-shadow: -8px 0 30px rgba(0,0,0,0.08);
    transform: translateX(102%); transition: transform 0.18s ease; overflow-y: auto; padding: 20px; z-index: 10; }
  .drawer.open { transform: none; }
  .drawer h2 { font-size: 14px; margin: 0 0 2px; }
  .drawer .cls { font-size: 11px; font-weight: 700; }
  .drawer h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-3); margin: 16px 0 6px; }
  .drawer pre { white-space: pre-wrap; word-break: break-word; font: 11px/1.5 ui-monospace, Menlo, monospace;
    background: #f6f5f3; border-radius: 8px; padding: 9px 11px; max-height: 260px; overflow: auto; margin: 0; }
  .drawer .x { position: absolute; top: 14px; right: 14px; border: none; background: none;
    font-size: 18px; cursor: pointer; color: var(--ink-3); }
  .flowlinks button { border: 1px solid var(--line); background: #fff; border-radius: 6px;
    padding: 2px 8px; margin: 0 4px 4px 0; cursor: pointer; font: 11px ui-monospace, Menlo, monospace; }
</style></head><body><div class="wrap">
<header>
  <h1>Run graph <span style="font-family:ui-monospace,Menlo,monospace;font-weight:500;color:var(--ink-2)">${esc(graph.runId)}</span></h1>
  <div class="sub">agent <b>${esc(graph.agentId)}</b> · ${esc(graph.startedAt ?? '')} ·
    <a href="/s/${esc(graph.runId)}?key=${k}">transcript</a> · <a href="/ui?key=${k}">dashboard</a></div>
</header>

<div class="tiles">
  <div class="tile"><div class="v">$${graph.costUsd.toFixed(2)}</div><div class="k">run cost</div></div>
  <div class="tile"><div class="v">${graph.nodes.length}</div><div class="k">steps</div></div>
  <div class="tile"><div class="v">${headroom}%</div><div class="k">compile headroom</div>
    <div class="bar"><i style="width:${headroom}%"></i></div></div>
  <div class="tile"><div class="v">${occurrences.filter((o) => o.verdict !== 'repeated').length}</div><div class="k">switchable segments</div></div>
  <div class="tile"><div class="v" style="color:${errors ? ERROR_COLOR : 'inherit'}">${errors}</div><div class="k">error steps</div></div>
</div>

<div class="legend">
  ${(Object.keys(CLASS_META) as StepClass[])
    .map((c) => `<span class="sw"><span class="dot" style="background:${CLASS_META[c].color}"></span>${CLASS_META[c].name} (${counts[c]})</span>`)
    .join('')}
  <span class="sw"><span class="dot" style="background:${ERROR_COLOR}"></span>Error (${errors})</span>
  <span class="sw" style="margin-left:auto">click a step to inspect · outlined groups repeat across runs</span>
</div>

<div class="notice">${revealed
    ? '<b>Revealed:</b> raw content including any secrets. <a href="?key=' + k + '">back to protected view</a>'
    : '<b>Protected view:</b> credential-shaped values are redacted. <a href="?key=' + k + '&reveal=1">reveal raw content</a> (owner only)'}</div>

<div class="flowcard"><div class="flow">${flowHtml}</div></div>

<aside class="drawer" id="drawer">
  <button class="x" onclick="closeDrawer()">✕</button>
  <div id="drawer-body"></div>
</aside>

<script>
const NODES = ${JSON.stringify(nodeData).replace(/</g, '\\u003c')};
const CLASS_META = ${JSON.stringify(CLASS_META)};
const drawer = document.getElementById('drawer');
const body = document.getElementById('drawer-body');
let selected = null;
function esc(s){const d=document.createElement('div');d.textContent=s??'';return d.innerHTML;}
function closeDrawer(){drawer.classList.remove('open');clearSel();}
function clearSel(){document.querySelectorAll('.chip.sel,.chip.flowmark').forEach(c=>c.classList.remove('sel','flowmark'));selected=null;}
function jump(i){const el=document.querySelector('.chip[data-i="'+i+'"]');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});open_(i);}}
function open_(i){
  clearSel();
  const n = NODES[i]; selected = i;
  const el = document.querySelector('.chip[data-i="'+i+'"]'); if (el) el.classList.add('sel');
  n.inflow.concat(n.outflow).forEach(j=>{const e=document.querySelector('.chip[data-i="'+j+'"]');if(e)e.classList.add('flowmark');});
  const m = CLASS_META[n.cls];
  body.innerHTML =
    '<h2>#'+i+' · '+esc(n.label.split(' ')[0])+'</h2>'+
    '<span class="cls" style="color:'+m.color+'">'+m.icon+' '+m.name+(n.err?' · <span style=\\'color:#e34948\\'>ERROR</span>':'')+'</span>'+
    ' <span style="font-size:11px;color:#8f8e8a">· est cost share $'+n.cost+'</span>'+
    '<h3>Canonical label</h3><pre>'+esc(n.label)+'</pre>'+
    (n.canonical?'<h3>Canonical I/O (what the fingerprint hashes)</h3><pre>'+esc(n.canonical)+'</pre>':'')+
    (n.raw?'<h3>Payload</h3><pre>'+esc(n.raw)+'</pre>':'')+
    ((n.inflow.length||n.outflow.length)?'<h3>Dataflow</h3><div class="flowlinks">'+
      n.inflow.map(j=>'<button onclick="jump('+j+')">⇧ from #'+j+'</button>').join('')+
      n.outflow.map(j=>'<button onclick="jump('+j+')">⇩ to #'+j+'</button>').join('')+'</div>':'');
  drawer.classList.add('open');
}
document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>open_(Number(c.dataset.i))));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});
</script>
</div></body></html>`;
}
