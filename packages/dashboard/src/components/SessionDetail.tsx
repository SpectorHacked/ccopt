import { useState, useEffect } from 'react';
import { Ic } from '../icons.tsx';

interface Step {
  kind: 'model_turn' | 'tool_use' | 'tool_result' | 'thinking';
  name: string;
  payload: string;
  isError?: boolean;
  toolUseId?: string;
}
interface Parsed {
  models?: string[];
  usageByModel?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>;
  costUsd?: number;
  steps?: Step[];
}
interface RunRow {
  session_id: string;
  agent_id: string;
  started_at: string | null;
  ended_at: string | null;
  cost_usd: string | number;
  n_steps: number;
  models: string[];
  parsed: Parsed;
}

const KIND: Record<Step['kind'], { label: string; icon: string; cls: string }> = {
  model_turn: { label: 'LLM turn', icon: 'spark', cls: 'k-llm' },
  tool_use: { label: 'Tool call', icon: 'wrench', cls: 'k-tool' },
  tool_result: { label: 'Result', icon: 'arrowRight', cls: 'k-result' },
  thinking: { label: 'Reasoning', icon: 'bulb', cls: 'k-think' },
};

export function SessionDetail({ sessionId, optimized, onBack }: { sessionId: string; optimized: boolean; onBack: () => void }) {
  const [run, setRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setLoading(true);
    setErr(false);
    fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { run: RunRow }) => setRun(d.run))
      .catch(() => setErr(true))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const steps = run?.parsed?.steps ?? [];
  const models = run?.models ?? run?.parsed?.models ?? [];
  const dur =
    run?.started_at && run?.ended_at
      ? `${Math.max(1, Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 1000))}s`
      : '—';
  const cost = run ? `$${Number(run.cost_usd).toFixed(4)}` : '—';

  return (
    <section className="dag">
      <div className="dag-bar">
        <button className="btn-ghost" onClick={onBack}>
          <Ic n="arrowRight" style={{ width: 15, height: 15, transform: 'rotate(180deg)' }} /> Sessions
        </button>
      </div>

      <div className="dag-head">
        <div>
          <div className="mono-name" style={{ fontSize: 15 }}>{sessionId}</div>
          <div className="sub" style={{ marginTop: 4 }}>
            {run?.agent_id ?? '…'}
            {optimized && <span className="opt-badge" style={{ marginLeft: 10 }}><Ic n="spark" style={{ width: 11, height: 11 }} /> Optimized</span>}
          </div>
        </div>
        <div className="dag-stats">
          <div className="stat"><span className="v tnum">{steps.length || run?.n_steps || 0}</span><span className="k">Steps</span></div>
          <div className="stat"><span className="v tnum">{dur}</span><span className="k">Duration</span></div>
          <div className="stat"><span className="v tnum">{cost}</span><span className="k">Cost</span></div>
        </div>
      </div>

      <div className="dag-models">
        <span className="dag-models-label">Models used</span>
        {models.length ? models.map((m) => <span key={m} className="chip">{m}</span>) : <span className="chip">unknown</span>}
        {models.length > 1 && <span className="dag-models-note">multi-model run — routed across {models.length} models</span>}
      </div>

      {loading && <div className="dag-empty">Loading run…</div>}
      {err && <div className="dag-empty">Couldn’t load this run.</div>}
      {!loading && !err && steps.length === 0 && <div className="dag-empty">This run has no captured steps.</div>}

      {!loading && !err && steps.length > 0 && (
        <ol className="dag-flow">
          {steps.map((s, i) => {
            const meta = KIND[s.kind] ?? KIND.tool_use;
            const err = s.isError;
            return (
              <li key={i} className={`dag-node ${meta.cls} ${err ? 'is-error' : ''}`}>
                <span className="dag-node-ico"><Ic n={meta.icon} /></span>
                <div className="dag-node-body">
                  <div className="dag-node-top">
                    <span className="dag-node-kind">{meta.label}</span>
                    <span className="dag-node-name">{s.kind === 'model_turn' ? models[0] ?? s.name : s.name}</span>
                    {err && <span className="dag-node-err">error</span>}
                  </div>
                  {s.payload && <div className="dag-node-payload">{s.payload.slice(0, 240)}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
