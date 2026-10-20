import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { COMMON_CURRENCIES } from '../../shared/money';
import { accountTypes } from '../../shared/constants';
import { del, patch, post } from '../api';
import { MoneyInput } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { Title } from '../components/Shell';
import { useToast } from '../components/Toast';
import { useLookups, useWrite } from '../data';
import type { Account } from '../types';
import { ACCOUNT_TYPE_LABEL, localToday, money } from '../util';

export function AccountsPage() {
  const { accounts, base, data } = useLookups();
  const [params, setParams] = useSearchParams();
  const [showClosed, setShowClosed] = useState(false);
  const open = accounts.filter((a) => !a.closed);
  const closed = accounts.filter((a) => a.closed);
  const assets = open.reduce((s, a) => s + Math.max(a.balanceBase ?? 0, 0), 0);
  const debts = open.reduce((s, a) => s + Math.max(-(a.balanceBase ?? 0), 0), 0);
  let i = 0;

  const list = (title: string, items: Account[]) => items.length > 0 && (
    <section className="section">
      <div className="meta"><span>{title}</span><span className="num">{money(items.reduce((s, a) => s + (a.balanceBase ?? 0), 0), base)}</span></div>
      <ul className="rows">
        {items.map((a) => (
          <li key={a.id} style={{ ['--i' as string]: i++ }}>
            <Link className="row" to={`/accounts/${a.id}`}>
              <span style={{ minWidth: 0 }}>
                <span className="name" style={{ display: 'block' }}>{a.name}</span>
                <span className="sub">{ACCOUNT_TYPE_LABEL[a.type]}{a.currency !== base && a.balanceBase !== null ? ` · ${money(a.balanceBase, base)}` : ''}</span>
              </span>
              <span className="detail">{money(a.balance, a.currency)}<span className="arrow">→</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <main className="page">
      <Title aside={<button className="link" onClick={() => setParams({ new: '1' })}>New account</button>}>Accounts</Title>
      {data && !accounts.length ? (
        <p className="empty">No accounts yet. <button className="link" onClick={() => setParams({ new: '1' })}>Add your first</button>.</p>
      ) : (
        <>
          <div className="stats">
            <div className="stat"><div className="value">{money(assets - debts, base)}</div><div className="label">Net worth</div></div>
            <div className="stat"><div className="value small-value">{money(assets, base)}</div><div className="label">Assets</div></div>
            <div className="stat"><div className="value small-value">{money(debts, base)}</div><div className="label">Debts</div></div>
          </div>
          {list('Budget', open.filter((a) => a.onBudget))}
          {list('Tracking', open.filter((a) => !a.onBudget))}
          {closed.length > 0 && (
            <section className="section">
              <button className="link muted small" onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'Hide' : 'Show'} closed accounts ({closed.length})</button>
              {showClosed && list('Closed', closed)}
            </section>
          )}
          <p className="small muted" style={{ marginTop: 48 }}><Link className="link muted" to="/scheduled">Scheduled transactions →</Link></p>
        </>
      )}
      <AccountSheet open={params.get('new') === '1'} onClose={() => setParams({})} />
    </main>
  );
}

export function AccountSheet({ open, onClose, account }: { open: boolean; onClose: () => void; account?: Account }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { base } = useLookups();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'checking');
  const [currency, setCurrency] = useState(account?.currency ?? base);
  const [onBudget, setOnBudget] = useState(account?.onBudget ?? true);
  const [balance, setBalance] = useState<number | null>(0);
  const [date, setDate] = useState(localToday());
  const [error, setError] = useState('');

  const save = useWrite(() => account
    ? patch(`/api/accounts/${account.id}`, { name, type, onBudget })
    : post('/api/accounts', { name, type, currency, onBudget, startingBalance: balance ?? 0, startingDate: date }));
  const close = useWrite(() => patch(`/api/accounts/${account!.id}`, { closed: !account!.closed }));
  const remove = useWrite(() => del(`/api/accounts/${account!.id}`));

  return (
    <Sheet open={open} onClose={onClose} title={account ? 'Edit account' : 'New account'}>
      <form onSubmit={(e) => {
        e.preventDefault();
        setError('');
        save.mutate(undefined, {
          onSuccess: (row: { id: string }) => { toast(account ? 'Saved' : 'Account added'); onClose(); if (!account) navigate(`/accounts/${row.id}`); },
          onError: (err) => setError(err.message),
        });
      }}>
        <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus={!account} placeholder="Nordea checking" /></label>
        <div className="grid2">
          <label className="field"><span>Type</span>
            <select className="input" value={type} onChange={(e) => { setType(e.target.value); if (!account) setOnBudget(!['investment', 'loan'].includes(e.target.value)); }}>
              {accountTypes.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className="field"><span>Currency</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!!account}>
              {COMMON_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {!account && (
          <div className="grid2">
            <label className="field"><span>{type === 'credit' || type === 'loan' ? 'Balance owed (negative)' : 'Current balance'}</span><MoneyInput value={balance} onChange={setBalance} /></label>
            <label className="field"><span>As of</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={onBudget} onChange={(e) => setOnBudget(e.target.checked)} />In the budget</label>
        <p className="small muted" style={{ marginTop: -8 }}>Budget accounts hold money you assign to categories. Tracking accounts, such as investments or a mortgage, only count toward net worth.</p>
        {error && <p className="error">{error}</p>}
        <div className="sheet-foot">
          {account ? (
            <div className="actions small">
              <button type="button" className="link muted" onClick={() => close.mutate(undefined, { onSuccess: () => { toast(account.closed ? 'Reopened' : 'Closed'); onClose(); } })}>{account.closed ? 'Reopen' : 'Close account'}</button>
              <button type="button" className="link danger" onClick={() => {
                if (!confirm(`Delete ${account.name} and its ${account.transactionCount} transactions? This can't be undone.`)) return;
                remove.mutate(undefined, { onSuccess: () => { toast('Deleted'); onClose(); navigate('/accounts'); } });
              }}>Delete</button>
            </div>
          ) : <span />}
          <button className="btn" disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save'}</button>
        </div>
      </form>
    </Sheet>
  );
}
