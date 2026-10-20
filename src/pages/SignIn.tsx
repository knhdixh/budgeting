import { useEffect, useRef, useState } from 'react';

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

export function SignIn() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const error = new URLSearchParams(location.search).get('error');
  useEffect(() => {
    // The water trail script finds #fluid when it runs; load it once per page.
    if (document.querySelector('script[src="/fluid.js"]')) return;
    const s = document.createElement('script');
    s.src = '/fluid.js';
    document.body.appendChild(s);
  }, []);
  return (
    <>
      <canvas id="fluid" ref={canvas} aria-hidden />
      <main className="signin">
        <Display />
        <div className="meta"><span>Private</span><span>01</span></div>
        <ul className="rows">
          <li>
            <a className="row" href="/auth/google">
              <span className="name">Continue with Google</span>
              <span className="detail">sign in<span className="arrow">→</span></span>
            </a>
          </li>
        </ul>
        {error && <p className="error">{error}</p>}
        <footer className="foot"><span>budgeting.knhdixh.com</span><span>{new Date().getFullYear()}</span></footer>
      </main>
    </>
  );
}
