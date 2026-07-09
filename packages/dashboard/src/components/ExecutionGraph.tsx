import { useState } from 'react';
import { flowOriginal, flowOptimized, graphLegend, type Flow } from '../data.ts';
import { Ic } from '../icons.tsx';

function FlowCol({ flow }: { flow: Flow }) {
  return (
    <div className="flow-col">
      <div className="flow-top">
        <span className={`flow-name ${flow.optimized ? 'opt' : ''}`}>{flow.name}</span>
        {flow.metrics.map((m) => <span key={m} className="chip tnum">{m}</span>)}
      </div>
      {flow.levels.map((level, i) => (
        <div key={i} className="level">
          {level.map((n, j) => (
            <div key={j} className={`node ${n.kind ?? ''}`}>
              {n.label}
              {n.sub && <small>{n.sub}</small>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ExecutionGraph() {
  const [view, setView] = useState<'original' | 'optimized'>('optimized');
  return (
    <section className="panel panel-pad">
      <div className="graph-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="panel-title">Execution Graph</span>
            <span className="badge-beta">BETA</span>
          </div>
          <div className="panel-sub">Original vs Optimized execution flow</div>
        </div>
        <div className="toggle">
          <button className={view === 'original' ? 'on' : ''} onClick={() => setView('original')}>Original</button>
          <button className={view === 'optimized' ? 'on' : ''} onClick={() => setView('optimized')}>
            <Ic n="spark" style={{ width: 13, height: 13 }} /> Optimized
          </button>
        </div>
      </div>

      <div className="flows">
        <FlowCol flow={flowOriginal} />
        <div className="arrow-mid"><Ic n="arrowRight" /></div>
        <FlowCol flow={flowOptimized} />
      </div>

      <div className="legend">
        {graphLegend.map((l) => (
          <span key={l.label}><i style={{ background: l.color }} /> {l.label}</span>
        ))}
      </div>
    </section>
  );
}
