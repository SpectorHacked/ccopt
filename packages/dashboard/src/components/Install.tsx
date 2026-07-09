import { useState } from 'react';
import { installMethods, installStep1 } from '../data.ts';
import { Ic } from '../icons.tsx';

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="code">
      <button className="code-copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      <pre>{code}</pre>
    </div>
  );
}

export function Install({ onClose }: { onClose: () => void }) {
  const [sel, setSel] = useState(installMethods[0].key);
  const method = installMethods.find((m) => m.key === sel)!;
  return (
    <div className="main-inner install-wrap">
      <header className="head">
        <div>
          <div className="install-back" onClick={onClose}><Ic n="arrowRight" style={{ width: 15, height: 15, transform: 'rotate(180deg)' }} /> Back to dashboard</div>
          <h1>Install Optimizer on any agent</h1>
          <div className="sub">One scoped key per agent, then pick how it's captured. The graph/cost engine is the same for every harness.</div>
        </div>
      </header>

      <section className="panel panel-pad" style={{ marginBottom: 16 }}>
        <div className="step-num">1</div>
        <div className="step-body">
          <div className="panel-title">{installStep1.label}</div>
          <CodeBlock code={installStep1.code} />
        </div>
      </section>

      <div className="step-num2">2 · Choose the capture method for your agent</div>
      <div className="install-grid">
        <div className="method-list">
          {installMethods.map((m) => (
            <button key={m.key} className={`method-item ${m.key === sel ? 'on' : ''}`} onClick={() => setSel(m.key)}>
              <span className="list-ico" style={{ background: `color-mix(in srgb, ${m.tint} 16%, transparent)`, color: m.tint }}>
                <Ic n={m.icon} />
              </span>
              <span className="method-item-txt">
                <span className="t">{m.name}</span>
                <span className="s">{m.tag}</span>
              </span>
            </button>
          ))}
        </div>

        <section className="panel panel-pad method-detail">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="list-ico" style={{ background: `color-mix(in srgb, ${method.tint} 16%, transparent)`, color: method.tint }}>
              <Ic n={method.icon} />
            </span>
            <div>
              <div className="panel-title">{method.name}</div>
              <div className="panel-sub">{method.tag}</div>
            </div>
          </div>
          <p style={{ color: 'var(--txt-2)', maxWidth: '62ch' }}>{method.blurb}</p>
          {method.steps.map((s, i) => (
            <div key={i} style={{ marginTop: 14 }}>
              <div className="step-label">{s.label}</div>
              <CodeBlock code={s.code} />
            </div>
          ))}
        </section>
      </div>

      <div className="foot-note" style={{ marginTop: 18 }}>
        Every method normalizes into the same execution graph — so cost, determinism, and optimizations look identical no matter which harness the agent runs on.
      </div>
    </div>
  );
}
