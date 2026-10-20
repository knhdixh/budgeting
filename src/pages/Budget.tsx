import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { addMonths, formatMonth } from '../../shared/dates';
import { parseMoney } from '../../shared/money';
import { patch, post, put } from '../api';
import { CategorySelect, MoneyInput } from '../components/Fields';
import { Title } from '../components/Shell';
import { useToast } from '../components/Toast';
import { useUI } from '../components/UI';
import { useBudget, useLookups, useWrite } from '../data';
import type { Category, CategoryMonth } from '../types';
import { money, thisMonth } from '../util';

export function BudgetPage() {
  const [params, setParams] = useSearchParams();
  const month = params.get('m') ?? thisMonth();
  const setMonth = (m: string) => setParams(m === thisMonth() ? {} : { m });
  const { groups, base, data } = useLookups();
  const budget = useBudget(month);
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const auto = useWrite((mode: 'targets' | 'last_month' | 'average') => post(`/api/budget/${month}/auto`, { mode }));
  const runAuto = (mode: 'targets' | 'last_month' | 'average', label: string) =>
    auto.mutate(mode, { onSuccess: (r: { total: number }) => toast(r.total ? `${label}: ${money(r.total, base, true)}` : 'Nothing to change') });

  const b = budget.data;
  const rta = b?.readyToAssign ?? 0;
  const expenseGroups = groups.filter((g) => !g.isIncome && (showHidden || !g.hidden));
  const incomeGroups = groups.filter((g) => g.isIncome);
  const hiddenCount = groups.reduce((n, g) => n + g.categories.filter((c) => c.hidden).length + (g.hidden ? 1 : 0), 0);
  let i = 0;

  return (
    <main className="page">
      <Title aside={
        <div className="actions">
          <button className="link muted" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">←</button>
          {month !== thisMonth() && <button className="link muted" onClick={() => setMonth(thisMonth())}>Today</button>}
          <button className="link muted" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">→</button>
        </div>
      }>{formatMonth(month)}</Title>

      <div className="stats">
        <div className="stat">
          <div className={`value ${rta < 0 ? 'danger' : ''}`}>{b ? money(rta, base) : '—'}</div>
          <div className="label">{rta < 0 ? 'Over-assigned' : 'Ready to assign'}</div>
        </div>
        <div className="stat">
          <div className="value small-value">{b ? money(b.assigned, base) : '—'}</div>
          <div className="label">Assigned</div>
        </div>
        <div className="stat">
          <div className="value small-value">{b ? money(b.activity, base) : '—'}</div>
          <div className="label">Spent</div>
        </div>
      </div>

      {(b?.overspentLastMonth || data?.uncategorized || b?.underfunded) ? (
        <div className="meta" style={{ display: 'block', paddingBottom: 28 }}>
          {b?.overspentLastMonth ? <p style={{ margin: '0 0 4px' }}>{money(b.overspentLastMonth, base)} overspent in {formatMonth(addMonths(month, -1), 'long').split(' ')[0]} came out of this month.</p> : null}
          {data?.uncategorized ? <p style={{ margin: '0 0 4px' }}><Link className="link" to="/transactions?category=uncategorized">{data.uncategorized} uncategorized</Link> transaction{data.uncategorized === 1 ? '' : 's'} to review.</p> : null}
          {b?.underfunded ? <p style={{ margin: 0 }}>{money(b.underfunded, base)} more needed for targets.</p> : null}
        </div>
      ) : null}

      <div className="actions" style={{ marginBottom: 40, fontSize: 13 }}>
        <button className="link" onClick={() => runAuto('targets', 'Assigned to targets')}>Fund targets</button>
        <button className="link muted" onClick={() => runAuto('last_month', 'Copied last month')}>Copy last month</button>
        <button className="link muted" onClick={() => runAuto('average', 'Assigned average spending')}>Average spending</button>
        {hiddenCount > 0 && <button className="link muted" onClick={() => setShowHidden(!showHidden)}>{showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}</button>}
      </div>

      <div className="budget-head">
        <span>Category</span><span>Assigned</span><span className="col-activity">Activity</span><span>Available</span>
      </div>

      {!b && budget.isLoading && <p className="loading">Loading</p>}
      {b && expenseGroups.map((g) => {
        const cats = g.categories.filter((c) => showHidden || !c.hidden);
        const sum = (k: keyof CategoryMonth) => cats.reduce((s, c) => s + (b.categories[c.id]?.[k] ?? 0), 0);
        return (
          <section key={g.id}>
            <div className="group-head">
              <span>{g.name}{g.hidden ? ' · hidden' : ''}</span>
              <span className="num">{money(sum('available'), base)}</span>
            </div>
            <ul className="rows">
              {cats.map((c) => (
                <li key={c.id} style={{ ['--i' as string]: i++ }}>
                  <CategoryRow
                    category={c}
                    m={b.categories[c.id] ?? { assigned: 0, activity: 0, carryover: 0, available: 0, underfunded: 0 }}
                    month={month}
                    base={base}
                    open={open === c.id}
                    onToggle={() => setOpen(open === c.id ? null : c.id)}
                  />
                </li>
              ))}
              {!cats.length && <li><p className="empty">No categories.</p></li>}
            </ul>
          </section>
        );
      })}

      {b && (
        <section className="section">
          <div className="meta"><span>Income this month</span><span className="num">{money(b.income, base)}</span></div>
          <ul className="rows">
            {incomeGroups.flatMap((g) => g.categories).map((c) => (
              <li key={c.id}>
                <Link className="row" to={`/transactions?category=${c.id}`}>
                  <span className="name">{c.name}</span><span className="detail">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function targetHint(c: Category, m: CategoryMonth, base: string) {
  if (m.available < 0) return `Overspent ${money(-m.available, base)}`;
  if (c.targetType === 'none') return null;
  if (m.underfunded > 0) return `${money(m.underfunded, base)} more needed`;
  return c.targetType === 'monthly' ? 'Funded' : 'On track';
}

function CategoryRow({ category: c, m, month, base, open, onToggle }: {
  category: Category; m: CategoryMonth; month: string; base: string; open: boolean; onToggle: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const assign = useWrite((cents: number) => put(`/api/budget/${month}/${c.id}`, { assigned: cents }));
  const toast = useToast();

  const commit = () => {
    if (draft === null) return;
    const trimmed = draft.trim();
    // "+20" and "-5" adjust the current amount; anything else replaces it.
    const v = parseMoney(trimmed);
    setDraft(null);
    if (v === null) return;
    const next = /^[+-]/.test(trimmed) ? m.assigned + v : v;
    if (next !== m.assigned) assign.mutate(next, { onError: (e) => toast(e.message) });
  };

  const funded = m.carryover + m.assigned;
  const spent = -Math.min(m.activity, 0);
  const ratio = funded > 0 ? Math.min(spent / funded, 1) : spent > 0 ? 1 : 0;
  const hint = targetHint(c, m, base);

  return (
    <>
      <div className="budget-row">
        <button className="name" onClick={onToggle} aria-expanded={open}>
          {c.name}{c.hidden ? ' · hidden' : ''}
          {hint && <span className={`hint ${m.available < 0 ? 'danger' : ''}`}>{hint}</span>}
        </button>
        <input
          className="cell-input"
          inputMode="decimal"
          aria-label={`Assigned to ${c.name}`}
          value={draft ?? (m.assigned ? (m.assigned / 100).toFixed(2) : '')}
          placeholder="0.00"
          onFocus={(e) => { setDraft(m.assigned ? (m.assigned / 100).toFixed(2) : ''); requestAnimationFrame(() => e.target.select()); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); } }}
        />
        <span className="col-activity num muted">{m.activity ? money(m.activity, base) : '—'}</span>
        <span className={`available ${m.available < 0 ? 'danger' : m.available === 0 ? 'zero' : ''}`}>
          {money(m.available, base)}
          {(funded > 0 || spent > 0) && <div className="bar" aria-hidden><i style={{ width: `${ratio * 100}%` }} /></div>}
        </span>
      </div>
      {open && <CategoryDetail category={c} m={m} month={month} base={base} />}
    </>
  );
}

function CategoryDetail({ category: c, m, month, base }: { category: Category; m: CategoryMonth; month: string; base: string }) {
  const toast = useToast();
  const { openTransaction } = useUI();
  const [targetType, setTargetType] = useState(c.targetType);
  const [targetAmount, setTargetAmount] = useState<number | null>(c.targetAmount || null);
  const [targetDate, setTargetDate] = useState(c.targetDate ?? '');
  const [moveAmount, setMoveAmount] = useState<number | null>(m.available < 0 ? -m.available : null);
  const [moveOther, setMoveOther] = useState<string | null>(null);
  const [direction, setDirection] = useState<'to' | 'from'>(m.available < 0 ? 'from' : 'to');

  const saveTarget = useWrite(() => patch(`/api/categories/${c.id}`, {
    targetType, targetAmount: targetType === 'none' ? 0 : targetAmount ?? 0, targetDate: targetType === 'by_date' ? targetDate || null : null,
  }));
  const move = useWrite(() => post(`/api/budget/${month}/move`, direction === 'to'
    ? { from: c.id, to: moveOther, amount: moveAmount }
    : { from: moveOther, to: c.id, amount: moveAmount }));
  const hide = useWrite(() => patch(`/api/categories/${c.id}`, { hidden: !c.hidden }));

  return (
    <div className="budget-detail">
      <div className="grid2">
        <div>
          <span className="label">Target</span>
          <div className="seg" style={{ marginBottom: 12 }}>
            {(['none', 'monthly', 'by_date'] as const).map((t) => (
              <button key={t} type="button" className={targetType === t ? 'on' : ''} onClick={() => setTargetType(t)}>{{ none: 'None', monthly: 'Monthly', by_date: 'By date' }[t]}</button>
            ))}
          </div>
          {targetType !== 'none' && (
            <>
              <label className="field"><span>{targetType === 'monthly' ? 'Each month' : 'Total'}</span><MoneyInput value={targetAmount} onChange={setTargetAmount} /></label>
              {targetType === 'by_date' && <label className="field"><span>By</span><input className="input" type="month" value={targetDate.slice(0, 7)} onChange={(e) => setTargetDate(e.target.value)} /></label>}
            </>
          )}
          <button className="link" onClick={() => saveTarget.mutate(undefined, { onSuccess: () => toast('Target saved'), onError: (e) => toast(e.message) })}>Save target</button>
        </div>
        <div>
          <span className="label">Move money</span>
          <div className="seg" style={{ marginBottom: 12 }}>
            <button type="button" className={direction === 'to' ? 'on' : ''} onClick={() => setDirection('to')}>Give</button>
            <button type="button" className={direction === 'from' ? 'on' : ''} onClick={() => setDirection('from')}>Take</button>
          </div>
          <label className="field"><span>Amount</span><MoneyInput value={moveAmount} onChange={setMoveAmount} /></label>
          <label className="field"><span>{direction === 'to' ? 'To' : 'From'}</span><CategorySelect value={moveOther} onChange={setMoveOther} includeIncome={false} emptyLabel="Ready to assign" /></label>
          <button className="link" disabled={!moveAmount} onClick={() => move.mutate(undefined, { onSuccess: () => toast(`Moved ${money(moveAmount ?? 0, base)}`), onError: (e) => toast(e.message) })}>Move</button>
        </div>
      </div>
      <div className="actions small" style={{ marginTop: 20 }}>
        <Link className="link muted" to={`/transactions?category=${c.id}`}>Transactions</Link>
        <button className="link muted" onClick={() => openTransaction({ defaults: { categoryId: c.id } })}>Add transaction</button>
        <button className="link muted" onClick={() => hide.mutate(undefined)}>{c.hidden ? 'Unhide' : 'Hide'}</button>
        <span className="muted">Carried over {money(m.carryover, base)}</span>
      </div>
    </div>
  );
}
