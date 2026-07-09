import { kgCoverage } from '../data.ts';
import { Donut } from '../charts.tsx';

/** Knowledge Graph the agents retrieve against instead of re-deriving context
 *  with LLM calls. (Demo-backed until the KG engine lands.) */
export function KnowledgeGraph() {
  return (
    <div className="page-stack">
      <section className="panel panel-pad">
        <div className="panel-title" style={{ marginBottom: 4 }}>Knowledge Graph coverage</div>
        <div className="panel-sub" style={{ marginBottom: 18 }}>
          Entities Optimizer indexed from your agents’ runs, retrieved deterministically in place of LLM lookups.
        </div>
        <div className="kg-layout">
          <div className="kg-donut">
            <Donut segments={[{ value: kgCoverage.pct, color: 'var(--cyan)' }, { value: 100 - kgCoverage.pct, color: 'transparent' }]} size={148} thickness={14}>
              <div style={{ textAlign: 'center' }}>
                <div className="tnum" style={{ fontSize: 30, fontWeight: 750, lineHeight: 1 }}>{kgCoverage.pct}%</div>
                <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>indexed</div>
              </div>
            </Donut>
          </div>
          <div className="kg-entities">
            {kgCoverage.rows.map((r) => (
              <div key={r.l} className="kg-entity">
                <span className="k"><i className="dot" style={{ background: r.color, boxShadow: 'none' }} /> {r.l}</span>
                <span className="v tnum">{r.v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="foot-note" style={{ marginTop: 16 }}>{kgCoverage.foot}</div>
      </section>
    </div>
  );
}
