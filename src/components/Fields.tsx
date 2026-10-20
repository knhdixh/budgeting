import { useEffect, useState } from 'react';
import { parseMoney } from '../../shared/money';
import { useLookups } from '../data';

/** Amount field that accepts "12,50", "1 234.56" or "12+3.40". Reports cents, or null while invalid. */
export function MoneyInput({ value, onChange, className = 'input', autoFocus, placeholder = '0.00', id, ariaLabel }: {
  value: number | null; onChange: (cents: number | null) => void; className?: string; autoFocus?: boolean; placeholder?: string; id?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(value === null ? '' : (value / 100).toFixed(2));
  useEffect(() => {
    if (value !== parseMoney(text)) setText(value === null ? '' : (value / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      className={className}
      inputMode="decimal"
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={text}
      onChange={(e) => { setText(e.target.value); onChange(parseMoney(e.target.value)); }}
      onBlur={() => { const v = parseMoney(text); if (v !== null) setText((Math.abs(v) / 100).toFixed(2)); }}
      onFocus={(e) => e.target.select()}
    />
  );
}

export function CategorySelect({ value, onChange, includeIncome = true, emptyLabel = 'Uncategorized', id }: {
  value: string | null; onChange: (id: string | null) => void; includeIncome?: boolean; emptyLabel?: string; id?: string;
}) {
  const { groups } = useLookups();
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {groups.filter((g) => includeIncome || !g.isIncome).map((g) => (
        <optgroup key={g.id} label={g.name}>
          {g.categories.filter((c) => !c.hidden || c.id === value).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function AccountSelect({ value, onChange, exclude, emptyLabel, id }: {
  value: string | null; onChange: (id: string | null) => void; exclude?: string | null; emptyLabel?: string; id?: string;
}) {
  const { openAccounts } = useLookups();
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {openAccounts.filter((a) => a.id !== exclude).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );
}
