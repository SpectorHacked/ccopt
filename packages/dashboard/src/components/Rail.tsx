import { topOptimizations, recentTools, confidence } from '../data.ts';
import { Ic } from '../icons.tsx';
import { Donut } from '../charts.tsx';

function tint(c: string) {
  return { background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c };
}

export function Rail() {
  return (
    <div className="rail">
      <section className="panel panel-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="panel-title">Top Optimizations</span>
          <span className="link">View all</span>
        </div>
        {topOptimizations.map((o) => (
          <div key={o.t} className="list-row">
            <span className="list-ico" style={tint(o.tint)}><Ic n={o.icon} /></span>
            <div className="list-main">
              <div className="t">{o.t}</div>
              <div className="s">{o.s}</div>
            </div>
            <span className="list-val" style={{ color: 'var(--green)' }}>{o.v}</span>
          </div>
        ))}
      </section>

      <section className="panel panel-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="panel-title">Recently Generated Tools</span>
          <span className="link">View all</span>
        </div>
        {recentTools.map((t) => (
          <div key={t.name} className="list-row">
            <span className="list-ico" style={tint(t.tint)}><Ic n={t.icon} /></span>
            <div className="list-main">
              <div className="mono-name">{t.name}</div>
              <div className="s">{t.s}</div>
            </div>
            <span className="list-val" style={{ color: 'var(--txt-3)' }}>{t.v}</span>
          </div>
        ))}
      </section>

      <section className="panel panel-pad">
        <div className="panel-title" style={{ marginBottom: 14 }}>Optimization Confidence</div>
        <div className="donut-wrap">
          <Donut segments={confidence.segments} size={104} thickness={11}>
            <span className="tnum" style={{ fontSize: 24, fontWeight: 750 }}>{confidence.pct}%</span>
          </Donut>
          <div className="dot-legend" style={{ flex: 1 }}>
            {confidence.legend.map((r) => (
              <div key={r.l} className="row">
                <span className="l"><i className="dot" style={{ background: r.color, boxShadow: 'none' }} /> {r.l}</span>
                <span className="tnum" style={{ color: 'var(--txt-2)' }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
