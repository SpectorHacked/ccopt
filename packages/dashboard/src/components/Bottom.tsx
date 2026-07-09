import { learning, kgCoverage, routing } from '../data.ts';
import { Ic } from '../icons.tsx';
import { Donut } from '../charts.tsx';

export function Bottom() {
  return (
    <div className="bottom">
      {/* Learning progress */}
      <section className="panel panel-pad">
        <div className="panel-title" style={{ marginBottom: 16 }}>Learning Progress</div>
        <div className="donut-wrap">
          <Donut segments={learning.segments} size={108} thickness={11}>
            <div>
              <div className="tnum" style={{ fontSize: 26, fontWeight: 750, lineHeight: 1 }}>{learning.count}</div>
              <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>{learning.unit}</div>
            </div>
          </Donut>
          <div style={{ flex: 1 }}>
            {learning.phases.map((p) => (
              <div key={p.l} className="phase-row">
                <span style={{ color: 'var(--txt-2)' }}>{p.l}</span>
                {p.state === 'done'
                  ? <span className="tag-done">Complete <Ic n="check" style={{ width: 13, height: 13 }} /></span>
                  : <span className="tag-active">Active <span className="dot" style={{ background: 'var(--accent-2)', boxShadow: 'none' }} /></span>}
              </div>
            ))}
          </div>
        </div>
        <div className="foot-note">{learning.foot}</div>
      </section>

      {/* Knowledge graph coverage */}
      <section className="panel panel-pad">
        <div className="panel-title" style={{ marginBottom: 16 }}>Knowledge Graph Coverage</div>
        <div className="donut-wrap">
          <Donut segments={[{ value: kgCoverage.pct, color: 'var(--cyan)' }, { value: 100 - kgCoverage.pct, color: 'transparent' }]} size={108} thickness={11}>
            <span className="tnum" style={{ fontSize: 25, fontWeight: 750 }}>{kgCoverage.pct}%</span>
          </Donut>
          <div style={{ flex: 1 }}>
            {kgCoverage.rows.map((r) => (
              <div key={r.l} className="kv-row">
                <span className="k"><i className="dot" style={{ background: r.color, boxShadow: 'none' }} /> {r.l}</span>
                <span className="v tnum">{r.v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="foot-note">{kgCoverage.foot}</div>
      </section>

      {/* Model routing efficiency */}
      <section className="panel panel-pad">
        <div className="panel-title" style={{ marginBottom: 16 }}>Model Routing Efficiency</div>
        <div>
          {routing.rows.map((r) => (
            <div key={r.l} className="bar-row">
              <span style={{ color: 'var(--txt-2)' }}>{r.l}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${r.pct}%`, background: r.color }} /></span>
              <span className="bar-pct tnum">{r.pct}%</span>
              <span className={`delta ${r.tone}`} style={{ width: 44, justifyContent: 'flex-end' }}>{r.delta}</span>
            </div>
          ))}
        </div>
        <div className="foot-note">{routing.foot}</div>
      </section>
    </div>
  );
}
