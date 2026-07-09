import { useState } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { Kpis } from './components/Kpis.tsx';
import { ExecutionGraph } from './components/ExecutionGraph.tsx';
import { Rail } from './components/Rail.tsx';
import { Bottom } from './components/Bottom.tsx';
import { Install } from './components/Install.tsx';
import { Ic } from './icons.tsx';

export default function App() {
  const [view, setView] = useState<'dashboard' | 'install'>('dashboard');
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {view === 'install' ? (
          <Install onClose={() => setView('dashboard')} />
        ) : (
        <div className="main-inner">
          <header className="head">
            <div>
              <h1>Agent Optimization Overview</h1>
              <div className="sub">Optimizer continuously improves your agents' performance</div>
            </div>
            <div className="head-actions">
              <span className="pill">Last 7 days <Ic n="calendar" style={{ width: 15, height: 15, opacity: 0.7 }} /></span>
              <button className="btn-primary" onClick={() => setView('install')}><Ic n="spark" style={{ width: 15, height: 15 }} /> Install Optimizer</button>
            </div>
          </header>

          <Kpis />

          <div className="mid">
            <div className="mid-left">
              <ExecutionGraph />
              <Bottom />
            </div>
            <Rail />
          </div>
        </div>
        )}
      </main>
    </div>
  );
}
