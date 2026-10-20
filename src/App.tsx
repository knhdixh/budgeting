import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { Link, Route, Routes } from 'react-router';
import { ApiError, get } from './api';
import { Shell } from './components/Shell';
import { UIProvider } from './components/UI';
import { AccountsPage } from './pages/Accounts';
import { BudgetPage } from './pages/Budget';
import { ScheduledPage } from './pages/Scheduled';
import { Setup, SignIn } from './pages/SignIn';
import { TransactionsPage } from './pages/Transactions';

// Charts are the heaviest dependency, so reports load on demand.
const ReportsPage = lazy(() => import('./pages/Reports'));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

export function App() {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => get<{ email: string }>('/api/me'),
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
    staleTime: Infinity,
  });
  useEffect(() => {
    const out = () => qc.setQueryData(['me'], null);
    window.addEventListener('signed-out', out);
    return () => window.removeEventListener('signed-out', out);
  }, [qc]);

  if (location.pathname === '/setup') return <Setup />;
  if (me.isLoading) return null;
  if (!me.data) return <SignIn />;

  return (
    <UIProvider>
      <Shell>
        <Suspense fallback={<main className="page"><p className="loading">Loading</p></main>}>
          <Routes>
            <Route path="/" element={<BudgetPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:id" element={<TransactionsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/scheduled" element={<ScheduledPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Shell>
    </UIProvider>
  );
}

function NotFound() {
  return (
    <main className="page">
      <h1 className="display">404</h1>
      <p className="muted">Nothing here.</p>
      <Link className="link" to="/">Back</Link>
    </main>
  );
}
