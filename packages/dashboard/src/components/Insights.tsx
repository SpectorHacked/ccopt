import { useState, useEffect } from 'react';
import { ALL_AGENTS } from '../data.ts';
import { Ic } from '../icons.tsx';

interface Opportunity {
  index: number;
  kind: string;
  kindLabel: string;
  name: string;
  preview: string;
  score: number;
  action: 'replace' | 'cache';
  runs: number;
  estTokens: number;
  estUsd: number;
}
interface AgentInsight {
  agentId: string;
  runCount: number;
  steps: number;
  meanScore: number;
  totalEstUsd: number;
  opportunities: Opportunity[];
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ACTION: Record<string, { label: string; cls: string }> = {
  replace: { label: 'Replace with tool', cls: 'act-replace' },
  cache: { label: 'Cache', cls: 'act-cache' },
};

export function Insights({ agent }: { agent: string }) {
  const [data, setData] = useState<AgentInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = agent && agent !== ALL_AGENTS ? `?agent=${encodeURIComponent(agent)}` : '';
    fetch(`/api/v1/insights${q}`)
      .then((r) => (r.ok ? r.json() : { insights: [] }))
      .then((d: { insights?: AgentInsight[] }) => setData(d.insights ?? []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [agent]);

  const totalUsd = data.reduce((s, a) => s + a.totalEstUsd, 0);
  const totalOpps = data.reduce((s, a) => s + a.opportunities.length, 0);

  return (
    <div className="page-stack">
      <div className="sess-totals">
        <div className="totstat"><span className="k">Agents analyzed</span><span className="v tnum">{data.length}</span></div>
        <div className="totstat"><span className="k">Opportunities</span><span className="v tnum">{totalOpps}</span></div>
        <div className="totstat"><span className="k">Est. savings / run-set</span><span className="v tnum">{usd(totalUsd)}</span></div>
      </div>

      {loading && <div className="dag-empty">Analyzing runs…</div>}
      {!loading && data.length === 0 && (
        <div className="dag-empty">Not enough runs to analyze yet — determinism needs at least 2 runs of the same shape per agent.</div>
      )}

      {!loading && data.map((a) => (
        <section key={a.agentId} className="panel panel-pad">
          <div className="ins-head">
            <div>
              <div className="mono-name" style={{ fontSize: 14 }}>{a.agentId}</div>
              <div className="panel-sub">
                {a.runCount} runs · {a.steps} steps · determinism {a.meanScore}/100 · {a.opportunities.length} optimization{a.opportunities.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="ins-save">
              <span className="ins-save-v tnum">{usd(a.totalEstUsd)}</span>
              <span className="ins-save-k">est. removable cost</span>
            </div>
          </div>

          {a.opportunities.length === 0 ? (
            <div className="foot-note" style={{ marginTop: 10 }}>No deterministic steps found — this agent’s work varies run to run.</div>
          ) : (
            <div className="ins-list">
              {a.opportunities.map((o) => {
                const act = ACTION[o.action];
                return (
                  <div key={o.index} className="ins-row">
                    <span className="ins-step tnum">#{o.index + 1}</span>
                    <div className="ins-main">
                      <div className="ins-top">
                        <span className={`ins-act ${act.cls}`}>{act.label}</span>
                        <span className="ins-kind">{o.kindLabel}</span>
                        {o.name && o.name !== 'assistant' && <span className="mono-name" style={{ fontSize: 12 }}>{o.name}</span>}
                      </div>
                      {o.preview && <div className="ins-preview">{o.preview}</div>}
                    </div>
                    <div className="ins-metrics">
                      <span className="ins-score" title="value agreement across runs">
                        <b className="tnum">{o.score}</b>%
                      </span>
                      {o.estUsd > 0 && <span className="ins-usd tnum">{usd(o.estUsd)}</span>}
                      <span className="ins-runs tnum">{o.runs}×</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
