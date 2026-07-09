import { useState, useEffect } from 'react';
import { ALL_AGENTS } from '../data.ts';
import { Ic } from '../icons.tsx';

interface SessionRow {
  session_id: string;
  agent_id: string;
  started_at: string | null;
  cost_usd: string | number;
  n_steps: number;
  models: string[];
}

export function Sessions({
  agent,
  optimizedAgents,
  onOpen,
}: {
  agent: string;
  optimizedAgents: Set<string>;
  onOpen: (sessionId: string, optimized: boolean) => void;
}) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = agent && agent !== ALL_AGENTS ? `?agent=${encodeURIComponent(agent)}` : '';
    fetch(`/api/v1/sessions${q}`)
      .then((r) => (r.ok ? r.json() : { sessions: [] }))
      .then((d: { sessions?: SessionRow[] }) => setRows(d.sessions ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [agent]);

  const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');
  const fmtCost = (c: string | number) => `$${Number(c).toFixed(2)}`;

  return (
    <section className="panel tbl-panel">
      <div className="tbl-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Session</th>
              <th>Agent</th>
              <th>Started</th>
              <th className="num">Steps</th>
              <th className="num">Cost</th>
              <th>Models</th>
              <th aria-label="open" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const opt = optimizedAgents.has(r.agent_id);
              return (
                <tr key={r.session_id} className="row-click" onClick={() => onOpen(r.session_id, opt)}>
                  <td className="mono-name">{r.session_id}</td>
                  <td>
                    <span className="agent-cell">
                      {r.agent_id}
                      {opt && <span className="opt-badge" title="Optimizer has run on this agent"><Ic n="spark" style={{ width: 10, height: 10 }} /> Optimized</span>}
                    </span>
                  </td>
                  <td className="muted">{fmtDate(r.started_at)}</td>
                  <td className="num tnum">{r.n_steps}</td>
                  <td className="num tnum">{fmtCost(r.cost_usd)}</td>
                  <td>
                    <span className="model-chips">
                      {(r.models ?? []).map((m) => <span key={m} className="chip">{m}</span>)}
                    </span>
                  </td>
                  <td className="go"><Ic n="arrowRight" style={{ width: 15, height: 15 }} /></td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="tbl-empty">
                  No sessions yet for this workspace. Install Optimizer on an agent (or run the seed) and its runs show up here.
                </td>
              </tr>
            )}
            {loading && (
              <tr><td colSpan={7} className="tbl-empty">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
