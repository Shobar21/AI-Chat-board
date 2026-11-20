import { useState } from 'react';
import { api } from './api.js';
import { APP_NAME, MEANING, TAGLINE } from './config.js';

export default function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api(`/auth/${mode}`, { method: 'POST', body: { username, password } });
      onSignedIn(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function continueAsGuest() {
    setBusy(true);
    setError('');
    try {
      onSignedIn(await api('/auth/guest', { method: 'POST' }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <span className="blob b1" aria-hidden="true" />
      <span className="blob b2" aria-hidden="true" />
      <section className="auth-card">
        <div className="logo" aria-hidden="true">{APP_NAME[0]}</div>
        <div>
          <h1>{APP_NAME}</h1>
          <p className="meaning">{MEANING}</p>
        </div>
        <p className="auth-sub">{TAGLINE}</p>
        <form onSubmit={submit}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary big" disabled={busy}>
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="or" aria-hidden="true"><span>or</span></div>
        <button type="button" className="big" onClick={continueAsGuest} disabled={busy}>
          Try it as a guest
        </button>
        <button className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </section>
    </main>
  );
}
