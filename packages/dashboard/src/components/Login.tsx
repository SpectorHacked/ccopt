import { useState, type FormEvent } from 'react';
import { type Auth, verifyKey } from '../auth.ts';
import { Ic } from '../icons.tsx';

export function Login({ onAuth, onDemo }: { onAuth: (a: Auth) => void; onDemo: () => void }) {
  const [server, setServer] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) {
      setError('Enter your workspace API key.');
      return;
    }
    setBusy(true);
    setError('');
    const auth: Auth = { server: server.trim(), key: key.trim() };
    const ok = await verifyKey(auth);
    setBusy(false);
    if (ok) onAuth(auth);
    else setError('Key rejected or server unreachable. Check the key and server URL.');
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark"><Ic n="spark" /></span>
          <span className="brand-name">Optimizer</span>
        </div>
        <h1>Sign in to your workspace</h1>
        <p className="login-sub">Enter your tenant API key. Each workspace sees only its own agents and metrics.</p>

        <label className="fld">
          <span>Server URL <em>(optional — blank = this domain)</em></span>
          <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://api.optimizer.ai" autoComplete="off" />
        </label>
        <label className="fld">
          <span>API key</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="cck_…" autoComplete="off" spellCheck={false} />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="btn-primary login-btn" type="submit" disabled={busy}>
          {busy ? 'Verifying…' : 'Sign in'}
        </button>
        <button type="button" className="login-demo" onClick={onDemo}>Explore the demo instead →</button>
      </form>
    </div>
  );
}
