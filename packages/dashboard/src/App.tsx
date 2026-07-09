import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar.tsx';
import { Kpis } from './components/Kpis.tsx';
import { ExecutionGraph } from './components/ExecutionGraph.tsx';
import { Rail } from './components/Rail.tsx';
import { Bottom } from './components/Bottom.tsx';
import { Install } from './components/Install.tsx';
import { Login } from './components/Login.tsx';
import { Ic } from './icons.tsx';
import { loadAuth, saveAuth, clearAuth, fetchAgents, type Auth } from './auth.ts';
import { ALL_AGENTS, demoAgents } from './data.ts';

type Mode = 'login' | 'demo' | 'live';

export default function App() {
  const [mode, setMode] = useState<Mode>(() => (loadAuth() ? 'live' : 'login'));
  const [auth, setAuth] = useState<Auth | null>(() => loadAuth());
  const [agents, setAgents] = useState<string[]>([]);
  const [agent, setAgent] = useState<string>(ALL_AGENTS);
  const [view, setView] = useState<'dashboard' | 'install'>('dashboard');

  useEffect(() => {
    if (mode === 'live' && auth) {
      fetchAgents(auth).then((list) => setAgents(list.length ? list : demoAgents));
    } else if (mode === 'demo') {
      setAgents(demoAgents);
    }
  }, [mode, auth]);

  if (mode === 'login') {
    return (
      <Login
        onAuth={(a) => { saveAuth(a); setAuth(a); setMode('live'); }}
        onDemo={() => setMode('demo')}
      />
    );
  }

  const logout = () => { clearAuth(); setAuth(null); setAgents([]); setAgent(ALL_AGENTS); setMode('login'); };

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
                <div className="sub">
                  {agent === ALL_AGENTS ? "Optimizer continuously improves your agents' performance" : `Showing agent: ${agent}`}
                </div>
              </div>
              <div className="head-actions">
                <label className="agent-filter" title="Filter by agent">
                  <Ic n="route" style={{ width: 14, height: 14, opacity: 0.7 }} />
                  <select value={agent} onChange={(e) => setAgent(e.target.value)}>
                    <option value={ALL_AGENTS}>All agents</option>
                    {agents.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
                <button className="btn-primary" onClick={() => setView('install')}>
                  <Ic n="spark" style={{ width: 15, height: 15 }} /> Install Optimizer
                </button>
                {mode === 'live' ? (
                  <button className="pill session" onClick={logout} title="Sign out">
                    <span className="dot" /> Signed in · Sign out
                  </button>
                ) : (
                  <button className="pill session" onClick={() => setMode('login')}>Demo · Sign in</button>
                )}
              </div>
            </header>

            <Kpis agent={agent} />

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
