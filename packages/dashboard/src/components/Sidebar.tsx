import { nav } from '../data.ts';
import { Ic } from '../icons.tsx';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><Ic n="spark" /></span>
        <span className="brand-name">Optimizer</span>
      </div>

      {nav.map((block, i) =>
        'item' in block ? (
          <div key={i} className={`nav-item ${block.active ? 'active' : ''}`}>
            <Ic n={block.icon} /> {block.item}
          </div>
        ) : (
          <div key={i}>
            <div className="nav-group">{block.group}</div>
            {block.items.map(([label, icon]) => (
              <div key={label} className="nav-item">
                <Ic n={icon} /> {label}
              </div>
            ))}
          </div>
        ),
      )}

      <div className="sidebar-foot">
        <div className="live"><span className="dot" /> Optimizer is active</div>
        <div className="meta">Version 1.2.3<br />Learned from 247 executions</div>
      </div>
    </aside>
  );
}
