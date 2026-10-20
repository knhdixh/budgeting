import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { addDays, formatDate } from '../../shared/dates';
import { del, get, post, put } from '../api';
import { AccountSelect, CategorySelect, MoneyInput } from '../components/Fields';
import { Sheet } from '../components/Sheet';
import { Title } from '../components/Shell';
import { useToast } from '../components/Toast';
import { useLookups, useWrite } from '../data';
import type { Schedule } from '../types';
import { localToday, money } from '../util';

const FREQ: Record<Schedule['frequency'], [string, string]> = {
  daily: ['day', 'days'], weekly: ['week', 'weeks'], monthly: ['month', 'months'], yearly: ['year', 'years'],
};
const every = (s: Pick<Schedule, 'frequency' | 'interval'>) => (s.interval === 1 ? `Every ${FREQ[s.frequency][0]}` : `Every ${s.interval} ${FREQ[s.frequency][1]}`);

export function ScheduledPage() {
  const { account, category, base } = useLookups();
  const toast = useToast();
  const list = useQuery({ queryKey: ['schedules'], queryFn: () => get<Schedule[]>('/api/schedules') });
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const postNow = useWrite((id: string) => post(`/api/schedules/${id}/post`));
  const skip = useWrite((id: string) => post(`/api/schedules/${id}/skip`));
  const today = localToday();
  const soon = addDays(today, 30);
  const items = list.data ?? [];
  const upcoming = items.filter((s) => s.nextDate <= soon);
  const due30 = upcoming.reduce((sum, s) => sum + (s.transferAccountId ? 0 : s.amount), 0);

  return (
    <main className="page">
      <Title aside={<button className="link" onClick={() => setEditing('new')}>New</button>}>Scheduled</Title>
      <div className="stats">
        <div className="stat"><div className="value">{money(due30, base, true)}</div><div className="label">Next 30 days</div></div>
        <div className="stat"><div className="value small-value">{items.length}</div><div className="label">Schedules</div></div>
      </div>
      {list.isLoading && <p className="loading">Loading</p>}
      {!list.isLoading && !items.length && <p className="empty">No scheduled transactions. Add rent, salary or subscriptions.</p>}
      <ul className="rows">
        {items.map((s, i) => {
          const acc = account(s.accountId);
          const name = s.transferAccountId ? `To ${account(s.transferAccountId)?.name}` : s.payee ?? 'No payee';
          const due = s.nextDate <= today;
          return (
            <li key={s.id} style={{ ['--i' as string]: i }}>
              <div className="tx" role="button" tabIndex={0} onClick={() => setEditing(s)} onKeyDown={(e) => { if (e.key === 'Enter') setEditing(s); }}>
                <span className={`date ${due ? 'danger' : ''}`}>{formatDate(s.nextDate)}</span>
                <span className="who">
                  <span className="name">{name}</span>
                  <span className="sub">{[every(s), s.categoryId && category(s.categoryId)?.name, acc?.name, s.autoPost ? 'Auto' : null].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="amt">
                  {money(s.amount, acc?.currency ?? base, s.amount > 0)}
                  <span className="bal actions" style={{ justifyContent: 'flex-end', gap: 12 }} onClick={(e) => e.stopPropagation()}>
                    <button className="link muted" onClick={() => postNow.mutate(s.id, { onSuccess: () => toast('Posted') })}>Post</button>
                    <button className="link muted" onClick={() => skip.mutate(s.id, { onSuccess: () => toast('Skipped') })}>Skip</button>
                  </span>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <ScheduleSheet key={editing === 'new' ? 'new' : editing?.id ?? 'none'} schedule={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </main>
  );
}

function ScheduleSheet({ schedule: s, open, onClose }: { schedule: Schedule | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { openAccounts } = useLookups();
  const [kind, setKind] = useState<'expense' | 'income' | 'transfer'>(s?.transferAccountId ? 'transfer' : s && s.amount > 0 ? 'income' : 'expense');
  const [amount, setAmount] = useState<number | null>(s ? Math.abs(s.amount) : null);
  const [payee, setPayee] = useState(s?.payee ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(s?.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(s?.accountId ?? openAccounts[0]?.id ?? null);
  const [toAccountId, setToAccountId] = useState<string | null>(s?.transferAccountId ?? null);
  const [frequency, setFrequency] = useState<Schedule['frequency']>(s?.frequency ?? 'monthly');
  const [interval, setInterval] = useState(s?.interval ?? 1);
  const [startDate, setStartDate] = useState(s?.startDate ?? localToday());
  const [endDate, setEndDate] = useState(s?.endDate ?? '');
  const [autoPost, setAutoPost] = useState(s?.autoPost ?? true);
  const [memo, setMemo] = useState(s?.memo ?? '');
  const [error, setError] = useState('');
  useEffect(() => { if (!accountId && openAccounts[0]) setAccountId(openAccounts[0].id); }, [accountId, openAccounts]);

  const save = useWrite(() => {
    const body = {
      accountId, transferAccountId: kind === 'transfer' ? toAccountId : null, payee: kind === 'transfer' ? null : payee || null,
      categoryId: kind === 'transfer' ? null : categoryId, amount: (kind === 'income' ? 1 : -1) * (amount ?? 0), memo: memo || null,
      frequency, interval, startDate, endDate: endDate || null, autoPost,
    };
    return s ? put(`/api/schedules/${s.id}`, body) : post('/api/schedules', body);
  });
  const remove = useWrite(() => del(`/api/schedules/${s!.id}`));

  return (
    <Sheet open={open} onClose={onClose} title={s ? 'Schedule' : 'New schedule'}>
      <form onSubmit={(e) => { e.preventDefault(); setError(''); if (!amount) { setError('Enter an amount.'); return; } save.mutate(undefined, { onSuccess: () => { toast('Saved'); onClose(); }, onError: (err) => setError(err.message) }); }}>
        <div className="seg">
          {(['expense', 'income', 'transfer'] as const).map((k) => <button key={k} type="button" className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        </div>
        <label className="field"><span>Amount</span><MoneyInput className="input big" value={amount} onChange={setAmount} autoFocus={!s} /></label>
        {kind === 'transfer' ? (
          <div className="grid2">
            <label className="field"><span>From</span><AccountSelect value={accountId} onChange={setAccountId} /></label>
            <label className="field"><span>To</span><AccountSelect value={toAccountId} onChange={setToAccountId} exclude={accountId} emptyLabel="Choose" /></label>
          </div>
        ) : (
          <>
            <label className="field"><span>Payee</span><input className="input" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Landlord" /></label>
            <div className="grid2">
              <label className="field"><span>Category</span><CategorySelect value={categoryId} onChange={setCategoryId} /></label>
              <label className="field"><span>Account</span><AccountSelect value={accountId} onChange={setAccountId} /></label>
            </div>
          </>
        )}
        <div className="grid2">
          <label className="field"><span>Repeats</span>
            <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as Schedule['frequency'])}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
            </select>
          </label>
          <label className="field"><span>Every</span><input className="input" type="number" min={1} max={365} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))} /></label>
        </div>
        <div className="grid2">
          <label className="field"><span>First date</span><input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></label>
          <label className="field"><span>Ends</span><input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        </div>
        <label className="field"><span>Memo</span><input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />Add automatically on the day</label>
        {error && <p className="error">{error}</p>}
        <div className="sheet-foot">
          {s ? <button type="button" className="link danger" onClick={() => remove.mutate(undefined, { onSuccess: () => { toast('Deleted'); onClose(); } })}>Delete</button> : <span />}
          <button className="btn" disabled={save.isPending}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}
