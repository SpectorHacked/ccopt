'use client';
import { useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { ALL_AGENTS } from '../data.ts';

interface KEntry { id: string; kind: string; tool: string; key: string; value: string; support: number; confidence: number; estUsdPerRun: number }
interface KNode { id: string; type: 'fact' | 'entity'; label: string; kind?: string; factId?: string; entityType?: string; degree: number }
interface KEdge { from: string; to: string; rel: 'about' | 'lists' | 'mentions' }
interface Knowledge { agentId: string; runCount: number; entries: KEntry[]; nodes: KNode[]; edges: KEdge[] }
interface AgentInsight { agentId: string; knowledge?: Knowledge | null }

const KIND_COLOR: Record<string, string> = {
  file: 'var(--cyan)', listing: 'var(--blue)', search: 'var(--gold)', fetch: 'var(--purple)', value: 'var(--green)',
};

/** Deterministic hub-and-spoke layout: entities on a ring, each fact placed
 *  near the entity it is `about`. reactflow renders + lets the user drag. */
function layout(nodes: KNode[], edges: KEdge[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const entities = nodes.filter((n) => n.type === 'entity');
  const facts = nodes.filter((n) => n.type === 'fact');
  const subjectOf = new Map<string, string>();
  for (const e of edges) if (e.rel === 'about') subjectOf.set(e.from, e.to);
  const R = Math.max(280, entities.length * 90);
  entities.forEach((n, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, entities.length);
    pos.set(n.id, { x: R * Math.cos(a), y: R * Math.sin(a) });
  });
  const around = new Map<string, number>();
  facts.forEach((n, i) => {
    const sub = subjectOf.get(n.id);
    const base = sub ? pos.get(sub) : undefined;
    if (base) {
      const k = around.get(sub!) ?? 0;
      around.set(sub!, k + 1);
      const a = (2 * Math.PI * k) / 6 + 0.4;
      pos.set(n.id, { x: base.x + 130 * Math.cos(a), y: base.y + 130 * Math.sin(a) });
    } else {
      pos.set(n.id, { x: (i % 6) * 120 - 300, y: (Math.floor(i / 6)) * 90 });
    }
  });
  return pos;
}

export function KnowledgeGraphExplorer({ agent }: { agent: string }) {
  const [data, setData] = useState<Knowledge[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [sel, setSel] = useState<KNode | null>(null);

  useEffect(() => {
    setLoading(true);
    const q = agent && agent !== ALL_AGENTS ? `?agent=${encodeURIComponent(agent)}` : '';
    fetch(`/api/v1/insights${q}`)
      .then((r) => (r.ok ? r.json() : { insights: [] }))
      .then((d: { insights?: AgentInsight[] }) => {
        const kgs = (d.insights ?? [])
          .map((a) => a.knowledge)
          .filter((k): k is Knowledge => !!k && (k.nodes?.length ?? 0) > 0);
        setData(kgs);
        setPicked(kgs[0]?.agentId ?? null);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [agent]);

  const kg = useMemo(() => data.find((k) => k.agentId === picked) ?? data[0], [data, picked]);
  const entryByFact = useMemo(() => new Map((kg?.entries ?? []).map((e) => [e.id, e])), [kg]);

  const { nodes, edges } = useMemo(() => {
    if (!kg) return { nodes: [] as Node[], edges: [] as Edge[] };
    const pos = layout(kg.nodes, kg.edges);
    const nodes: Node[] = kg.nodes.map((n) => {
      const isEntity = n.type === 'entity';
      const color = isEntity ? 'var(--purple)' : (KIND_COLOR[n.kind ?? ''] ?? 'var(--txt-3)');
      return {
        id: n.id,
        position: pos.get(n.id) ?? { x: 0, y: 0 },
        data: { label: n.label },
        style: {
          background: 'var(--panel-2)',
          color: 'var(--txt)',
          border: `1px solid ${color}`,
          borderRadius: isEntity ? 10 : 6,
          fontSize: isEntity ? 12 : 11,
          fontWeight: isEntity ? 650 : 500,
          padding: isEntity ? '8px 12px' : '5px 9px',
          width: 'auto',
          maxWidth: 200,
          boxShadow: isEntity && n.degree > 1 ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : undefined,
        },
      };
    });
    const edges: Edge[] = kg.edges.map((e, i) => ({
      id: `e${i}`,
      source: e.from,
      target: e.to,
      label: e.rel,
      animated: e.rel !== 'about',
      style: { stroke: e.rel === 'about' ? 'var(--border)' : 'var(--accent-line)' },
      labelStyle: { fill: 'var(--txt-3)', fontSize: 9, textTransform: 'uppercase' },
      labelBgStyle: { fill: 'var(--panel)' },
    }));
    return { nodes, edges };
  }, [kg]);

  if (loading) return <div className="dag-empty">Building the knowledge graph…</div>;
  if (!kg) {
    return (
      <div className="dag-empty">
        No knowledge graph yet — it appears once an agent repeats stable lookups across runs
        (globs, greps, file reads) with the same answers.
      </div>
    );
  }

  const selEntry = sel?.factId ? entryByFact.get(sel.factId) : undefined;

  return (
    <div className="page-stack">
      <div className="kg-explorer-bar">
        <span className="panel-sub">
          <b>{kg.nodes.filter((n) => n.type === 'entity').length}</b> concepts ·{' '}
          <b>{kg.nodes.filter((n) => n.type === 'fact').length}</b> facts ·{' '}
          <b>{kg.edges.length}</b> connections · mined from {kg.runCount} runs
        </span>
        {data.length > 1 && (
          <select className="kg-agent-select" value={picked ?? ''} onChange={(e) => { setPicked(e.target.value); setSel(null); }}>
            {data.map((k) => <option key={k.agentId} value={k.agentId}>{k.agentId}</option>)}
          </select>
        )}
      </div>

      <div className="kg-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setSel(kg.nodes.find((x) => x.id === n.id) ?? null)}
          onPaneClick={() => setSel(null)}
        >
          <Background color="var(--border)" gap={18} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={() => 'var(--accent-line)'} maskColor="rgba(0,0,0,0.6)" style={{ background: 'var(--panel-2)' }} />
        </ReactFlow>

        {sel && (
          <div className="kg-detail">
            <div className="kg-detail-head">
              <span className={`ins-act ${sel.type === 'entity' ? 'act-template' : 'act-memoize'}`}>
                {sel.type === 'entity' ? sel.entityType : sel.kind}
              </span>
              <button className="kg-detail-x" onClick={() => setSel(null)} aria-label="close">×</button>
            </div>
            <div className="mono-name" style={{ fontSize: 13, wordBreak: 'break-all' }}>{sel.label}</div>
            {selEntry ? (
              <>
                <div className="panel-sub" style={{ margin: '8px 0' }}>
                  {selEntry.support}× · confidence {selEntry.confidence}/100 · ~${selEntry.estUsdPerRun}/run to re-derive
                </div>
                <pre className="kg-detail-val">{selEntry.value.slice(0, 1200)}</pre>
              </>
            ) : (
              <div className="panel-sub" style={{ marginTop: 8 }}>
                {sel.type === 'entity'
                  ? `${sel.degree} connection(s). Click a linked fact to see its value.`
                  : 'Fact node.'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
