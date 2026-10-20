import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { convert } from '../../shared/money';
import { del, get, post, put } from '../api';
import { useLookups, useWrite } from '../data';
import type { TransactionInput } from '../../shared/schemas';
import { localToday, money } from '../util';
import { AccountSelect, CategorySelect, MoneyInput } from './Fields';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

type Kind = 'expense' | 'income' | 'transfer';
interface SplitRow { categoryId: string | null; amount: number | null; memo: string }

export interface TxDefaults { accountId?: string; categoryId?: string; date?: string }

export function TransactionSheet({ open, id, defaults, onClose }: { open: boolean; id?: string; defaults?: TxDefaults; onClose: () => void }) {
  const toast = useToast();
  const { openAccounts, account, payees, data } = useLookups();
  const existing = useQuery({
    queryKey: ['tx', id],
    queryFn: () => get<Required<TransactionInput>>(`/api/transactions/${id}`),
    enabled: open && !!id,
    staleTime: 0,
  });

  const [kind, setKind] = useState<Kind>('expense');
  const [amount, setAmount] = useState<number | null>(null);
  const [received, setReceived] = useState<number | null>(null);
  const [payee, setPayee] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [date, setDate] = useState(localToday());
  const [memo, setMemo] = useState('');
  const [tags, setTags] = useState('');
  const [cleared, setCleared] = useState(false);
  const [splits, setSplits] = useState<SplitRow[] | null>(null);
  const [error, setError] = useState('');

  // Reset whenever the sheet opens, from the stored transaction or the defaults.
  useEffect(() => {
    if (!open) return;
    setError('');
    if (id && !existing.data) return;
    const t = existing.data;
    if (t) {
      const isTransfer = !!t.transferAccountId;
      const outgoing = t.amount <= 0;
      setKind(isTransfer ? 'transfer' : outgoing ? 'expense' : 'income');
      setAmount(Math.abs(t.amount));
      setPayee(t.payee ?? '');
      setCategoryId(t.categoryId ?? null);
      setAccountId(isTransfer && !outgoing ? t.transferAccountId! : t.accountId);
      setToAccountId(isTransfer ? (outgoing ? t.transferAccountId! : t.accountId) : null);
      setReceived(isTransfer ? Math.abs(outgoing ? t.transferAmount ?? 0 : t.amount) : null);
      if (isTransfer && !outgoing) setAmount(Math.abs(t.transferAmount ?? t.amount));
      setDate(t.date);
      setMemo(t.memo ?? '');
      setTags((t.tags ?? []).join(', '));
      setCleared(t.cleared !== 'uncleared');
      setSplits(t.splits?.length ? t.splits.map((s) => ({ categoryId: s.categoryId, amount: Math.abs(s.amount), memo: s.memo ?? '' })) : null);
    } else {
      setKind('expense');
      setAmount(null);
      setReceived(null);
      setPayee('');
      setCategoryId(defaults?.categoryId ?? null);
      setAccountId(defaults?.accountId ?? openAccounts.find((a) => a.onBudget)?.id ?? openAccounts[0]?.id ?? null);
      setToAccountId(null);
      setDate(defaults?.date ?? localToday());
      setMemo('');
      setTags('');
      setCleared(false);
      setSplits(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, existing.data]);

  const from = account(accountId);
  const to = account(toAccountId);
  const crossCurrency = kind === 'transfer' && from && to && from.currency !== to.currency;
  const crossesBudget = kind === 'transfer' && from && to && from.onBudget !== to.onBudget;
  const sign = kind === 'income' ? 1 : -1;
  const splitTotal = splits?.reduce((s, x) => s + (x.amount ?? 0), 0) ?? 0;

  // Suggest the received amount for transfers between currencies.
  useEffect(() => {
    if (crossCurrency && amount !== null && data && !id) {
      const r = data.rates;
      if (r[from!.currency] && r[to!.currency]) setReceived(convert(amount, r[from!.currency], r[to!.currency]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossCurrency, amount, from?.currency, to?.currency]);

  const save = useWrite(async () => {
    if (!accountId) throw new Error('Add an account first.');
    if (amount === null) throw new Error('Enter an amount.');
    const body: TransactionInput = {
      accountId,
      date,
      amount: kind === 'transfer' ? -amount : sign * amount,
      payee: kind === 'transfer' ? null : payee.trim() || null,
      categoryId: kind === 'transfer' && !crossesBudget ? null : splits ? null : categoryId,
      memo: memo.trim() || null,
      cleared: cleared ? 'cleared' : 'uncleared',
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      splits: kind !== 'transfer' && splits ? splits.map((s) => ({ categoryId: s.categoryId, amount: sign * (s.amount ?? 0), memo: s.memo || null })) : [],
      transferAccountId: kind === 'transfer' ? toAccountId : null,
      transferAmount: kind === 'transfer' && crossCurrency && received !== null ? received : null,
    };
    if (kind === 'transfer' && !toAccountId) throw new Error('Pick the account the money goes to.');
    if (splits && splitTotal !== amount) throw new Error(`Split parts add up to ${money(splitTotal, from?.currency)}, not ${money(amount, from?.currency)}.`);
    return id ? put(`/api/transactions/${id}`, body) : post('/api/transactions', body);
  });

  const remove = useWrite(() => del(`/api/transactions/${id}`));

  const submit = () => {
    setError('');
    save.mutate(undefined, {
      onSuccess: () => { toast(id ? 'Saved' : 'Added'); onClose(); },
      onError: (e) => setError(e.message),
    });
  };

  const onPayeeChange = (name: string) => {
    setPayee(name);
    const match = payees.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (match?.defaultCategoryId && !categoryId && !splits) setCategoryId(match.defaultCategoryId);
  };

  const payeeOptions = useMemo(() => [...payees].sort((a, b) => b.count - a.count).slice(0, 200), [payees]);

  if (!openAccounts.length && open) {
    return (
      <Sheet open={open} onClose={onClose} title="New transaction">
        <p className="muted">Add an account first.</p>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={id ? 'Transaction' : 'New transaction'}>
      {id && existing.isLoading ? <p className="loading">Loading</p> : (
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
        >
          <div className="seg" role="tablist">
            {(['expense', 'income', 'transfer'] as Kind[]).map((k) => (
              <button type="button" key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {k[0].toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Amount{from ? ` · ${from.currency}` : ''}</span>
            <MoneyInput className="input big" value={amount} onChange={setAmount} autoFocus={!id} ariaLabel="Amount" />
          </label>

          {kind === 'transfer' ? (
            <>
              <div className="grid2">
                <label className="field"><span>From</span><AccountSelect value={accountId} onChange={setAccountId} /></label>
                <label className="field"><span>To</span><AccountSelect value={toAccountId} onChange={setToAccountId} exclude={accountId} emptyLabel="Choose" /></label>
              </div>
              {crossCurrency && (
                <label className="field"><span>Received · {to!.currency}</span><MoneyInput value={received} onChange={setReceived} /></label>
              )}
              {crossesBudget && (
                <label className="field"><span>Category</span><CategorySelect value={categoryId} onChange={setCategoryId} emptyLabel="Ready to assign" /></label>
              )}
            </>
          ) : (
            <>
              <label className="field">
                <span>Payee</span>
                <input className="input" list="payee-list" value={payee} onChange={(e) => onPayeeChange(e.target.value)} placeholder="Who" autoComplete="off" />
                <datalist id="payee-list">{payeeOptions.map((p) => <option key={p.id} value={p.name} />)}</datalist>
              </label>
              {splits ? (
                <div className="field">
                  <span className="label">Split · {money(splitTotal, from?.currency)} of {money(amount ?? 0, from?.currency)}</span>
                  {splits.map((s, i) => (
                    <div key={i} className="grid2" style={{ gridTemplateColumns: '1fr 110px auto', alignItems: 'end' }}>
                      <CategorySelect value={s.categoryId} onChange={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, categoryId: v } : x)))} />
                      <MoneyInput value={s.amount} onChange={(v) => setSplits(splits.map((x, j) => (j === i ? { ...x, amount: v } : x)))} ariaLabel={`Part ${i + 1} amount`} />
                      <button type="button" className="link muted" aria-label="Remove part" onClick={() => setSplits(splits.length > 2 ? splits.filter((_, j) => j !== i) : null)}>×</button>
                    </div>
                  ))}
                  <div className="actions" style={{ marginTop: 12 }}>
                    <button type="button" className="link" onClick={() => setSplits([...splits, { categoryId: null, amount: Math.max((amount ?? 0) - splitTotal, 0), memo: '' }])}>+ Part</button>
                    <button type="button" className="link muted" onClick={() => setSplits(null)}>Don't split</button>
                  </div>
                </div>
              ) : (
                <label className="field">
                  <span style={{ display: 'flex', justifyContent: 'space-between' }}>Category
                    <button type="button" className="link muted small" onClick={() => setSplits([{ categoryId, amount, memo: '' }, { categoryId: null, amount: 0, memo: '' }])}>Split</button>
                  </span>
                  <CategorySelect value={categoryId} onChange={setCategoryId} />
                </label>
              )}
              <label className="field"><span>Account</span><AccountSelect value={accountId} onChange={setAccountId} /></label>
            </>
          )}

          <div className="grid2">
            <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
            <label className="field"><span>Tags</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="trip, work" /></label>
          </div>
          <label className="field"><span>Memo</span><input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Optional" /></label>
          <label className="check"><input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />Cleared</label>

          {error && <p className="error">{error}</p>}
          <div className="sheet-foot">
            {id ? (
              <button type="button" className="link danger" onClick={() => remove.mutate(undefined, { onSuccess: () => { toast('Deleted'); onClose(); }, onError: (e) => setError(e.message) })}>
                Delete
              </button>
            ) : <span className="muted small">⌘↵ to save</span>}
            <button className="btn" disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save'}</button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
