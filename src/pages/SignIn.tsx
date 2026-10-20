import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { post } from '../api';

const WORD = 'budgeting';
const GLYPHS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** The cookbook's display heading: characters rise from a mask while cycling glyphs, then settle. */
function Display() {
  const [chars, setChars] = useState(WORD.split(''));
  const [cursor, setCursor] = useState(false);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setCursor(true); return; }
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = now - t0;
      let done = true;
      setChars(WORD.split('').map((c, i) => {
        const start = 200 + i * 55, settle = start + 420 + i * 30;
        if (t >= settle) return c;
        done = false;
        return t >= start ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c;
      }));
      if (!done) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const timer = setTimeout(() => setCursor(true), 200 + WORD.length * 85 + 450);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, []);
  return (
    <h1 className="display" aria-label={WORD}>
      <span aria-hidden>{chars.map((c, i) => <span className="mask" key={i}><span className="ch" style={{ ['--i' as string]: i }}>{c}</span></span>)}</span>
      <span className={`cursor ${cursor ? 'on' : ''}`} aria-hidden />
    </h1>
  );
}

function useFluid() {
  useEffect(() => {
    // The water trail script finds #fluid when it runs; load it once per page.
    if (document.querySelector('script[src="/fluid.js"]')) return;
    const s = document.createElement('script');
    s.src = '/fluid.js';
    document.body.appendChild(s);
  }, []);
}

function AuthPage({ label, children }: { label: string; children: ReactNode }) {
  useFluid();
  return (
    <>
      <canvas id="fluid" aria-hidden />
      <main className="signin">
        <Display />
        <div className="meta"><span>{label}</span><span>Private</span></div>
        {children}
        <footer className="foot"><span>budgeting.knhdixh.com</span><span>{new Date().getFullYear()}</span></footer>
      </main>
    </>
  );
}

export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/login', { email, password });
      location.replace('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <AuthPage label="Sign in">
      <form className="auth-form" onSubmit={submit}>
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
      </form>
    </AuthPage>
  );
}

/** One-time password setup from a link with the token in the URL fragment (never sent to logs). */
export function Setup() {
  const token = location.hash.slice(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('The passwords don’t match.'); return; }
    setBusy(true);
    setError('');
    try {
      await post('/auth/setup', { token, email, password });
      location.replace('/');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <AuthPage label="Set password">
      {!token ? <p className="muted">This link is incomplete.</p> : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label className="field"><span>New password · at least 12 characters</span><input className="input" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <label className="field"><span>Repeat password</span><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
          {error && <p className="error">{error}</p>}
          <button className="btn" disabled={busy}>{busy ? 'Saving' : 'Set password'}</button>
        </form>
      )}
    </AuthPage>
  );
}
