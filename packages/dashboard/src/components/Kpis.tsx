import { kpis } from '../data.ts';
import { Ic } from '../icons.tsx';
import { Sparkline } from '../charts.tsx';

export function Kpis() {
  return (
    <div className="kpis">
      {kpis.map((k) => (
        <div key={k.key} className="kpi">
          <div className="kpi-head">
            <span className="kpi-ico" style={{ background: 'color-mix(in srgb, ' + k.tint + ' 16%, transparent)', color: k.tint }}>
              <Ic n={k.icon} />
            </span>
            {k.label}
          </div>
          <div className="kpi-val tnum">{k.value}</div>
          <div className="kpi-foot">
            <span className={`delta ${k.tone}`}>
              {k.dir === 'down' ? '↓' : '↑'} {k.delta}
            </span>
            <Sparkline points={k.spark} color={k.tint} />
          </div>
        </div>
      ))}
    </div>
  );
}
