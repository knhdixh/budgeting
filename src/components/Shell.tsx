import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { isTyping } from '../util';
import { CommandBar } from './CommandBar';
import { useUI } from './UI';

const LINKS = [
  { to: '/', label: 'Budget', end: true },
  { to: '/accounts', label: 'Accounts' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/reports', label: 'Reports' },
  { to: '/scheduled', label: 'Scheduled' },
  { to: '/settings', label: 'Settings' },
];
const GO: Record<string, string> = { b: '/', a: '/accounts', t: '/transactions', r: '/reports', s: '/scheduled', ',': '/settings' };

export function Shell({ children }: { children: ReactNode }) {
  const { openTransaction, setCommandOpen } = useUI();
  const navigate = useNavigate();
  const pendingG = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen(true); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || document.querySelector('dialog[open], [cmdk-dialog]')) return;
      const key = e.key.toLowerCase();
      if (Date.now() - pendingG.current < 1000 && GO[key]) { e.preventDefault(); pendingG.current = 0; navigate(GO[key]); return; }
      if (key === 'g') { pendingG.current = Date.now(); return; }
      if (key === 'n' || key === 'c') { e.preventDefault(); openTransaction(); }
      if (key === '/') { e.preventDefault(); navigate('/transactions?focus=1'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, openTransaction, setCommandOpen]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">budgeting</NavLink>
          <nav className="nav" aria-label="Main">
            {LINKS.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
          </nav>
          <button className="kbd-hint" onClick={() => setCommandOpen(true)} aria-label="Open command bar">⌘K</button>
        </div>
      </header>
      {children}
      <button className="btn fab" onClick={() => openTransaction()} aria-label="New transaction" title="New transaction (N)">+</button>
      <nav className="tabbar" aria-label="Main">
        {LINKS.filter((l) => l.to !== '/scheduled').map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label === 'Transactions' ? 'Activity' : l.label}</NavLink>)}
      </nav>
      <CommandBar />
    </div>
  );
}

/** Page title that rises from a mask, per the cookbook. */
export function Title({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="title-row">
      <h1 className="title"><span className="rise"><span>{children}</span></span></h1>
      {aside}
    </div>
  );
}
