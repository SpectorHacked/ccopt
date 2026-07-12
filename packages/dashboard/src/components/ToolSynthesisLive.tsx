import { useEffect, useState } from 'react';
import { ALL_AGENTS } from '../data.ts';

interface SynthTool {
  id: string;
  name: string;
  steps: number;
  tools: string[];
  params: { name: string; type: string; source: string }[];
  guarded: boolean;
  separability: string;
  evidence: { runs: number; support: number };
  savings: { perRunUsd: number; windowUsd: number };
  replay?: { runsChecked: number; passRate: number; status: string };
}
interface AgentInsight {
  agentId: string;
  tools?: SynthTool[];
}
type Row = SynthTool & { agentId: string };

const usd = (n: number) => `$${n.toFixed(4)}`;

/**
 * Real synthesized tools for the workspace, from the live determinism engine
 * (`/api/v1/insights` → `tools[]`). Read-only catalog across agents; per-agent
 * enable/disable lives in Sessions → an agent (the injected-tool registry).
 * Tools only appear for agents that repeat deterministic steps across runs.
 */
export function ToolSynthesisLive({ agent }: { agent: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = agent && agent !== ALL_AGENTS ? `?agent=${encodeURIComponent(agent)}` : '';
    fetch(`/api/v1/insights${q}`)
      .then((r) => (r.ok ? r.json() : { insights: [] }))
      .then((d: { insights?: AgentInsight[] }) => {
        const all: Row[] = (d.insights ?? []).flatMap((i) =>
          (i.tools ?? []).map((t) => ({ ...t, agentId: i.agentId })),
        );
        all.sort((a, b) => (b.savings?.windowUsd ?? 0) - (a.savings?.windowUsd ?? 0));
        setRows(all);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [agent]);

  const ready = rows.filter((t) => t.replay?.status === 'ready');
  const totalPerRun = rows.reduce((s, t) => s + (t.savings?.perRunUsd ?? 0), 0);

  if (loading) return <div className="dag-empty">Synthesizing tools from recent runs…</div>;

  if (rows.length === 0) {
    return (
      <section className="panel panel-pad" style={{ textAlign: 'center', padding: '56px 24px' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>No synthesized tools yet</h2>
        <p style={{ color: 'var(--txt-2)', maxWidth: '54ch', margin: '0 auto', lineHeight: 1.6 }}>
          Effigent compiles a tool when an agent repeats the same deterministic steps across runs.
          Highly varied work won’t surface tools here, but any repetitive procedure — a scheduled
          check, a scrape, a fixed lookup — will. In-progress candidates show under <b>Insights</b>.
        </p>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <div className="sess-totals">
        <div className="totstat"><span className="k">Synthesized tools</span><span className="v tnum">{rows.length}</span></div>
        <div className="totstat"><span className="k">Replay-validated</span><span className="v tnum">{ready.length}</span></div>
        <div className="totstat"><span className="k">Est. saving / run</span><span className="v tnum">{usd(totalPerRun)}</span></div>
      </div>

      <section className="panel panel-pad">
        <div className="ins-head">
          <div>
            <div className="mono-name" style={{ fontSize: 14 }}>Synthesized tools</div>
            <div className="panel-sub">
              Deterministic procedures compiled from repeated steps. Enable/disable per agent in
              Sessions → an agent.
            </div>
          </div>
        </div>
        <div className="ins-list">
          {rows.map((t) => (
            <div key={`${t.agentId}-${t.id}`} className="ins-row">
              <div className="ins-main">
                <div className="ins-top">
                  <span
                    className={`ins-act ${t.replay?.status === 'ready' ? 'act-replace' : 'act-route'}`}
                    title={t.replay?.status === 'ready'
                      ? 'replay-validated — active in the bundle'
                      : 'in shadow validation — not yet activated'}
                  >
                    {t.replay?.status ?? 'shadow'}
                  </span>
                  <span className="mono-name" style={{ fontSize: 12.5 }}>{t.name}</span>
                  <span className="ins-kind">
                    {t.agentId} · {t.steps} steps
                    {t.params.length ? ` · ${t.params.length} param${t.params.length === 1 ? '' : 's'}` : ''}
                    {t.guarded ? ' · ⚠ side-effect' : ''}
                  </span>
                </div>
                {t.tools?.length > 0 && <div className="ins-preview">{t.tools.join('  →  ')}</div>}
              </div>
              <div className="ins-metrics">
                {t.replay && (
                  <span className="ins-conf tnum" title="replay pass rate">
                    {Math.round(t.replay.passRate * 100)}%
                  </span>
                )}
                <span className="ins-usd tnum" title="measured saving per run">{usd(t.savings?.perRunUsd ?? 0)}</span>
                <span className="ins-runs tnum" title="share of runs containing this procedure">
                  {Math.round((t.evidence?.support ?? 0) * 100)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
