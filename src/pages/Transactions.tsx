import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { formatDate } from '../../shared/dates';
import { get, post } from '../api';
import { MoneyInput } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { Title } from '../components/Shell';
import { useToast } from '../components/Toast';
import { useUI } from '../components/UI';
import { useLookups, useWrite } from '../data';
import type { Tx } from '../types';
import { localToday, money } from '../util';
import { AccountSheet } from './Accounts';

const PAGE = 100;

export function TransactionsPage() {
  const { id: accountId } = useParams();
  const [params, setParams] = useSearchParams();
  const lookups = useLookups();
  const { account, category, groups, openAccounts, base } = lookups;
  const { openTransaction } = useUI();
  const toast = useToast();
  const acc = account(accountId);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [editAccount, setEditAccount] = useState(false);
  const [reconcile, setReconcile] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryFilter = params.get('category') ?? '';
  const accountFilter = accountId ?? params.get('account') ?? '';
  const uncleared = params.get('cleared') === 'uncleared';

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (params.get('focus')) { searchRef.current?.focus(); params.delete('focus'); setParams(params, { replace: true }); } }, [params, setParams]);
  useEffect(() => setSelected(null), [accountId]);
  // PWA shortcut: /transactions?new=1 opens a blank transaction.
  useEffect(() => { if (params.get('new')) { openTransaction(); params.delete('new'); setParams(params, { replace: true }); } }, [params, setParams, openTransaction]);

  const filters = new URLSearchParams();
  if (accountFilter) filters.set('account', accountFilter);
  if (categoryFilter) filters.set('category', categoryFilter);
  if (debounced) filters.set('q', debounced);
  if (uncleared) filters.set('cleared', 'uncleared');
  for (const k of ['payee', 'tag', 'from', 'to']) if (params.get(k)) filters.set(k, params.get(k)!);

  const query = useInfiniteQuery({
    queryKey: ['transactions', filters.toString()],
    queryFn: ({ pageParam }) => get<{ items: Tx[]; hasMore: boolean }>(`/api/transactions?${filters}&limit=${PAGE}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE : undefined),
    placeholderData: (prev) => prev,
  });
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  const bulk = useWrite((body: { action: string; categoryId?: string | null }) => post('/api/transactions/bulk', { ids: [...(selected ?? [])], ...body }));
  const runBulk = (body: { action: string; categoryId?: string | null }, label: string) =>
    bulk.mutate(body, { onSuccess: () => { toast(label); setSelected(new Set()); }, onError: (e) => toast(e.message) });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const describe = (t: Tx) => {
    if (t.transferAccountId) {
      const other = account(t.transferAccountId)?.name ?? 'account';
      return { name: t.amount < 0 ? `To ${other}` : `From ${other}`, sub: [t.categoryId ? category(t.categoryId)?.name : 'Transfer', !acc && account(t.accountId)?.name, t.memo].filter(Boolean).join(' · ') };
    }
    const cat = t.isSplit ? `Split (${t.splits.length})` : t.categoryId ? category(t.categoryId)?.name : 'Uncategorized';
    return { name: t.payee ?? t.memo ?? '—', sub: [cat, !acc && account(t.accountId)?.name, t.payee ? t.memo : null, ...t.tags.map((x) => `#${x}`)].filter(Boolean).join(' · ') };
  };

  const title = acc ? acc.name : categoryFilter === 'uncategorized' ? 'Uncategorized' : categoryFilter ? category(categoryFilter)?.name ?? 'Transactions' : 'Transactions';

  return (
    <main className="page">
      <Title aside={acc ? (
        <div className="actions small">
          <button className="link muted" onClick={() => setReconcile(true)}>Reconcile</button>
          <Link className="link muted" to={`/settings?account=${acc.id}#import`}>Import</Link>
          <button className="link muted" onClick={() => setEditAccount(true)}>Edit</button>
        </div>
      ) : <Link className="link muted small" to="/scheduled">Scheduled</Link>}>{title}</Title>

      {acc && (
        <div className="stats">
          <div className="stat"><div className="value">{money(acc.balance, acc.currency)}</div><div className="label">Balance{acc.closed ? ' · closed' : ''}</div></div>
          <div className="stat"><div className="value small-value">{money(acc.cleared, acc.currency)}</div><div className="label">Cleared</div></div>
          {acc.currency !== base && acc.balanceBase !== null && <div className="stat"><div className="value small-value">{money(acc.balanceBase, base)}</div><div className="label">In {base}</div></div>}
        </div>
      )}

      <div className="filters">
        <input ref={searchRef} className="input" type="search" placeholder="Search payee, memo, amount" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <select className="input" value={categoryFilter} onChange={(e) => setFilter('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {groups.map((g) => <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
        </select>
        {!accountId && (
          <select className="input" value={accountFilter} onChange={(e) => setFilter('account', e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {openAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      <div className="meta">
        <span className="actions">
          <button className={`link muted ${uncleared ? 'on' : ''}`} onClick={() => setFilter('cleared', uncleared ? '' : 'uncleared')}>{uncleared ? 'Uncleared only' : 'All'}</button>
          <button className="link muted" onClick={() => setSelected(selected ? null : new Set())}>{selected ? 'Done' : 'Select'}</button>
        </span>
        <span className="num">{items.length}{query.hasNextPage ? '+' : ''}</span>
      </div>

      {selected && selected.size > 0 && (
        <div className="bulkbar">
          <span>{selected.size} selected</span>
          <select aria-label="Categorize selected" value="" onChange={(e) => runBulk({ action: 'categorize', categoryId: e.target.value === '-' ? null : e.target.value }, 'Categorized')}>
            <option value="">Categorize…</option>
            <option value="-">Uncategorized</option>
            {groups.map((g) => <optgroup key={g.id} label={g.name}>{g.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>)}
          </select>
          <button onClick={() => runBulk({ action: 'clear' }, 'Marked cleared')}>Mark cleared</button>
          <button onClick={() => runBulk({ action: 'unclear' }, 'Marked uncleared')}>Mark uncleared</button>
          <button onClick={() => { if (confirm(`Delete ${selected.size} transactions?`)) runBulk({ action: 'delete' }, 'Deleted'); }}>Delete</button>
          <button onClick={() => setSelected(new Set(items.map((t) => t.id)))}>Select all</button>
        </div>
      )}

      {query.isLoading && <p className="loading">Loading</p>}
      {!query.isLoading && !items.length && <p className="empty">{debounced || categoryFilter ? 'No matching transactions.' : 'No transactions yet.'}</p>}
      <ul className="rows">
        {items.map((t, i) => {
          const d = describe(t);
          const cur = account(t.accountId)?.currency ?? base;
          const isSel = selected?.has(t.id);
          return (
            <li key={t.id} style={{ ['--i' as string]: i }}>
              <div
                className={`tx ${selected ? 'with-select' : ''} ${isSel ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (selected) { const n = new Set(selected); if (isSel) n.delete(t.id); else n.add(t.id); setSelected(n); }
                  else openTransaction({ id: t.id });
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
              >
                {selected && <input type="checkbox" className="selbox" checked={!!isSel} readOnly tabIndex={-1} aria-label="Select" />}
                <span className="date">{formatDate(t.date, t.date.slice(0, 4) !== localToday().slice(0, 4))}</span>
                <span className="who">
                  <span className="name">{d.name}{t.cleared === 'uncleared' && <span className="flag" title="Uncleared">·</span>}</span>
                  <span className={`sub ${!t.categoryId && !t.isSplit && !t.transferAccountId ? 'danger' : ''}`}>{d.sub}</span>
                </span>
                <span className="amt">
                  {money(t.amount, cur, t.amount > 0)}
                  {acc && <span className="bal">{money(t.running, cur)}</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {query.hasNextPage && (
        <p style={{ marginTop: 24 }}><button className="link" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>{query.isFetchingNextPage ? 'Loading' : 'Load more'}</button></p>
      )}

      {acc && <AccountSheet key={acc.id + String(editAccount)} open={editAccount} onClose={() => setEditAccount(false)} account={acc} />}
      {acc && <ReconcileSheet open={reconcile} onClose={() => setReconcile(false)} accountId={acc.id} cleared={acc.cleared} currency={acc.currency} />}
    </main>
  );
}

function ReconcileSheet({ open, onClose, accountId, cleared, currency }: { open: boolean; onClose: () => void; accountId: string; cleared: number; currency: string }) {
  const [balance, setBalance] = useState<number | null>(cleared);
  const toast = useToast();
  const run = useWrite(() => post<{ adjustment: number }>(`/api/accounts/${accountId}/reconcile`, { balance, date: localToday() }));
  useEffect(() => { if (open) setBalance(cleared); }, [open, cleared]);
  const diff = (balance ?? 0) - cleared;
  return (
    <Sheet open={open} onClose={onClose} title="Reconcile">
      <p className="muted" style={{ marginTop: 0 }}>Enter the balance your bank shows today. Cleared transactions get locked, and any difference is recorded as an adjustment.</p>
      <label className="field"><span>Bank balance · {currency}</span><MoneyInput className="input big" value={balance} onChange={setBalance} autoFocus /></label>
      <p className="small muted">Cleared in budgeting: {money(cleared, currency)}{diff ? ` · Adjustment: ${money(diff, currency, true)}` : ' · Matches'}</p>
      <div className="sheet-foot"><span />
        <button className="btn" disabled={balance === null || run.isPending} onClick={() => run.mutate(undefined, { onSuccess: (r) => { toast(r.adjustment ? `Reconciled with ${money(r.adjustment, currency, true)} adjustment` : 'Reconciled'); onClose(); } })}>Reconcile</button>
      </div>
    </Sheet>
  );
}
