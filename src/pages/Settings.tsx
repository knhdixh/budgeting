import { useQuery } from '@tanstack/react-query';
import Papa from 'papaparse';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { COMMON_CURRENCIES, ECB_CURRENCIES, parseMoney } from '../../shared/money';
import { del, get, patch, post, put } from '../api';
import { AccountSelect, CategorySelect } from '../components/Fields';
import { Title } from '../components/Shell';
import { useToast } from '../components/Toast';
import { useLookups, useWrite } from '../data';
import type { Category, Group } from '../types';
import { money } from '../util';

export function SettingsPage() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);
  return (
    <main className="page">
      <Title>Settings</Title>
      <Categories />
      <Payees />
      <Import />
      <Currency />
      <Data />
      <Account />
    </main>
  );
}

function Categories() {
  const { groups } = useLookups();
  const toast = useToast();
  const addGroup = useWrite((name: string) => post('/api/groups', { name }));
  return (
    <section className="section" id="categories">
      <div className="meta"><span>Categories</span>
        <button className="link muted" onClick={() => { const name = prompt('Group name'); if (name) addGroup.mutate(name, { onSuccess: () => toast('Group added') }); }}>+ Group</button>
      </div>
      {groups.map((g) => <GroupBlock key={g.id} group={g} />)}
    </section>
  );
}

function GroupBlock({ group: g }: { group: Group }) {
  const toast = useToast();
  const rename = useWrite((name: string) => patch(`/api/groups/${g.id}`, { name }));
  const hide = useWrite(() => patch(`/api/groups/${g.id}`, { hidden: !g.hidden }));
  const remove = useWrite(() => del(`/api/groups/${g.id}`));
  const add = useWrite((name: string) => post('/api/categories', { groupId: g.id, name }));
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="group-head" style={{ alignItems: 'baseline' }}>
        <InlineName value={g.name} onSave={(name) => rename.mutate(name)} muted />
        <span className="actions">
          <button className="link muted" onClick={() => { const name = prompt(`New category in ${g.name}`); if (name) add.mutate(name, { onSuccess: () => toast('Category added') }); }}>+ Category</button>
          {!g.isIncome && <button className="link muted" onClick={() => hide.mutate(undefined)}>{g.hidden ? 'Unhide' : 'Hide'}</button>}
          {!g.categories.length && <button className="link muted" onClick={() => remove.mutate(undefined, { onError: (e) => toast(e.message) })}>Delete</button>}
        </span>
      </div>
      <ul className="rows">
        {g.categories.map((c) => <li key={c.id}><CategoryLine category={c} /></li>)}
      </ul>
    </div>
  );
}

function CategoryLine({ category: c }: { category: Category }) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const [into, setInto] = useState<string | null>(null);
  const save = useWrite((body: Partial<Category>) => patch(`/api/categories/${c.id}`, body));
  const remove = useWrite(() => del(`/api/categories/${c.id}${into ? `?into=${into}` : ''}`));
  return (
    <div className="row" style={{ gridTemplateColumns: '1fr auto' }}>
      <InlineName value={c.name} onSave={(name) => save.mutate({ name })} />
      {deleting ? (
        <span className="actions small">
          <span style={{ width: 160 }}><CategorySelect value={into} onChange={setInto} emptyLabel="Leave uncategorized" /></span>
          <button className="link danger" onClick={() => remove.mutate(undefined, { onSuccess: () => toast('Deleted') })}>Delete</button>
          <button className="link muted" onClick={() => setDeleting(false)}>Cancel</button>
        </span>
      ) : (
        <span className="actions small">
          <button className="link muted" onClick={() => save.mutate({ hidden: !c.hidden })}>{c.hidden ? 'Unhide' : 'Hide'}</button>
          <button className="link muted" onClick={() => setDeleting(true)}>Delete</button>
        </span>
      )}
    </div>
  );
}

function InlineName({ value, onSave, muted }: { value: string; onSave: (v: string) => void; muted?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className="cell-input"
      style={{ textAlign: 'left', fontWeight: muted ? 400 : 500, color: muted ? 'var(--muted)' : undefined, fontSize: muted ? 13 : 15 }}
      value={v}
      aria-label="Name"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v.trim() && v !== value) onSave(v.trim()); else setV(value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Payees() {
  const { payees, category } = useLookups();
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const save = useWrite(({ id, body }: { id: string; body: Record<string, unknown> }) => patch(`/api/payees/${id}`, body));
  const merge = useWrite(({ id, into }: { id: string; into: string }) => post('/api/payees/merge', { ids: [id], into }));
  const list = payees.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  const shown = showAll || filter ? list : list.slice(0, 12);
  return (
    <section className="section" id="payees">
      <div className="meta"><span>Payees and rules</span><span className="num">{payees.length}</span></div>
      <p className="small muted" style={{ marginTop: 0 }}>New transactions from a payee get its category automatically.</p>
      <input className="input" placeholder="Filter payees" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 12 }} />
      <ul className="rows">
        {shown.map((p) => (
          <li key={p.id}>
            <div className="row" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 180px) auto' }}>
              <span style={{ minWidth: 0 }}>
                <InlineName value={p.name} onSave={(name) => save.mutate({ id: p.id, body: { name } }, { onError: (e) => toast(e.message) })} />
                <span className="sub">{p.count} transaction{p.count === 1 ? '' : 's'}{p.defaultCategoryId ? ` · ${category(p.defaultCategoryId)?.name}` : ''}</span>
              </span>
              <CategorySelect value={p.defaultCategoryId} onChange={(v) => save.mutate({ id: p.id, body: { defaultCategoryId: v } })} emptyLabel="No rule" />
              <select className="input small" style={{ width: 90 }} value="" aria-label={`Merge ${p.name} into`} onChange={(e) => {
                if (e.target.value && confirm(`Merge ${p.name} into ${payees.find((x) => x.id === e.target.value)?.name}?`)) merge.mutate({ id: p.id, into: e.target.value }, { onSuccess: () => toast('Merged') });
              }}>
                <option value="">Merge</option>
                {payees.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
          </li>
        ))}
      </ul>
      {!showAll && !filter && list.length > 12 && <p><button className="link muted small" onClick={() => setShowAll(true)}>Show all {list.length}</button></p>}
    </section>
  );
}

type Mapping = { date: string; amount: string; outflow: string; payee: string; memo: string; category: string };
const DATE_FORMATS = ['YYYY-MM-DD', 'DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;

function parseDate(s: string, fmt: (typeof DATE_FORMATS)[number]) {
  const parts = s.trim().split(/[^\d]/).filter(Boolean).map(Number);
  if (parts.length < 3) return null;
  let [y, m, d] = [0, 0, 0];
  if (fmt === 'YYYY-MM-DD') [y, m, d] = parts;
  else if (fmt === 'MM/DD/YYYY') [m, d, y] = parts;
  else [d, m, y] = parts;
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function guess(headers: string[], ...names: string[]) {
  return headers.find((h) => names.some((n) => h.toLowerCase().includes(n))) ?? '';
}

function Import() {
  const toast = useToast();
  const [params] = useSearchParams();
  const [accountId, setAccountId] = useState<string | null>(params.get('account'));
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Mapping>({ date: '', amount: '', outflow: '', payee: '', memo: '', category: '' });
  const [fmt, setFmt] = useState<(typeof DATE_FORMATS)[number]>('YYYY-MM-DD');
  const [flip, setFlip] = useState(false);
  const { openAccounts } = useLookups();
  useEffect(() => { if (!accountId && openAccounts[0]) setAccountId(openAccounts[0].id); }, [accountId, openAccounts]);

  const onFile = (file: File) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const h = res.meta.fields ?? [];
        setHeaders(h);
        setRows(res.data);
        setMap({
          date: guess(h, 'date', 'päivä', 'booking', 'datum'),
          amount: guess(h, 'amount', 'summa', 'määrä', 'inflow', 'betrag'),
          outflow: guess(h, 'outflow'),
          payee: guess(h, 'payee', 'saaja', 'description', 'name', 'merchant', 'counterparty'),
          memo: guess(h, 'memo', 'message', 'viesti', 'reference', 'note'),
          category: guess(h, 'category', 'kategoria'),
        });
        const sample = res.data[0]?.[guess(h, 'date', 'päivä', 'booking', 'datum')] ?? '';
        setFmt(/^\d{4}/.test(sample) ? 'YYYY-MM-DD' : sample.includes('.') ? 'DD.MM.YYYY' : 'DD/MM/YYYY');
      },
    });
  };

  const parsed = useMemo(() => rows.map((r) => {
    const inflow = map.amount ? parseMoney(r[map.amount] ?? '') : 0;
    const outflow = map.outflow ? parseMoney(r[map.outflow] ?? '') : 0;
    const amount = inflow === null || outflow === null ? null : (inflow ?? 0) - Math.abs(outflow ?? 0);
    return {
      date: map.date ? parseDate(r[map.date] ?? '', fmt) : null,
      amount: amount === null ? null : flip ? -amount : amount,
      payee: map.payee ? r[map.payee]?.trim() || null : null,
      memo: map.memo ? r[map.memo]?.trim() || null : null,
      category: map.category ? r[map.category]?.trim() || null : null,
    };
  }), [rows, map, fmt, flip]);
  const valid = parsed.filter((r): r is typeof r & { date: string; amount: number } => !!r.date && r.amount !== null && r.amount !== 0);

  const run = useWrite(() => post<{ imported: number; skipped: number }>('/api/import', { accountId, rows: valid }));

  const col = (key: keyof Mapping, label: string) => (
    <label className="field"><span>{label}</span>
      <select className="input" value={map[key]} onChange={(e) => setMap({ ...map, [key]: e.target.value })}>
        <option value="">None</option>
        {headers.map((h) => <option key={h}>{h}</option>)}
      </select>
    </label>
  );

  return (
    <section className="section" id="import">
      <div className="meta"><span>Import CSV</span></div>
      <p className="small muted" style={{ marginTop: 0 }}>Bank exports and YNAB, Actual or Wallet CSVs work. Importing the same file again skips rows already there.</p>
      <div className="grid2">
        <label className="field"><span>Into account</span><AccountSelect value={accountId} onChange={setAccountId} /></label>
        <label className="field"><span>File</span><input className="input" type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
      </div>
      {headers.length > 0 && (
        <>
          <div className="grid2">{col('date', 'Date')}
            <label className="field"><span>Date format</span>
              <select className="input" value={fmt} onChange={(e) => setFmt(e.target.value as typeof fmt)}>{DATE_FORMATS.map((f) => <option key={f}>{f}</option>)}</select>
            </label>
          </div>
          <div className="grid2">{col('amount', 'Amount (or inflow)')}{col('outflow', 'Outflow')}</div>
          <div className="grid2">{col('payee', 'Payee')}{col('memo', 'Memo')}</div>
          <div className="grid2">{col('category', 'Category')}<span /></div>
          <label className="check"><input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} />Spending is positive in this file</label>
          <div className="meta"><span>Preview</span><span className="num">{valid.length} of {rows.length} rows</span></div>
          <ul className="rows">
            {valid.slice(0, 5).map((r, i) => (
              <li key={i}><div className="row"><span style={{ minWidth: 0 }}><span className="name" style={{ display: 'block' }}>{r.payee ?? r.memo ?? '—'}</span><span className="sub">{r.date}{r.category ? ` · ${r.category}` : ''}</span></span><span className="detail">{money(r.amount)}</span></div></li>
            ))}
          </ul>
          <p style={{ marginTop: 20 }}>
            <button className="btn" disabled={!valid.length || !accountId || run.isPending} onClick={() => run.mutate(undefined, {
              onSuccess: (r) => { toast(`Imported ${r.imported}${r.skipped ? `, skipped ${r.skipped} already there` : ''}`); setRows([]); setHeaders([]); },
              onError: (e) => toast(e.message),
            })}>{run.isPending ? 'Importing' : `Import ${valid.length}`}</button>
          </p>
        </>
      )}
    </section>
  );
}

function Currency() {
  const { data, accounts } = useLookups();
  const toast = useToast();
  const save = useWrite((body: Record<string, string>) => patch('/api/settings', body));
  const setRate = useWrite(({ currency, rate }: { currency: string; rate: number | null }) => put('/api/rates/manual', { currency, rate }));
  const [manualCur, setManualCur] = useState('VND');
  const [manualRate, setManualRate] = useState('');
  if (!data) return null;
  const foreign = [...new Set(accounts.map((a) => a.currency))].filter((c) => c !== 'EUR');
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [data.settings.timeZone];
  return (
    <section className="section" id="currency">
      <div className="meta"><span>Currency and time</span></div>
      <div className="grid2">
        <label className="field"><span>Base currency</span>
          <select className="input" value={data.settings.baseCurrency} onChange={(e) => save.mutate({ baseCurrency: e.target.value }, { onSuccess: () => toast('Saved'), onError: (err) => toast(err.message) })}>
            {ECB_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Time zone</span>
          <select className="input" value={data.settings.timeZone} onChange={(e) => save.mutate({ timeZone: e.target.value }, { onSuccess: () => toast('Saved') })}>
            {zones.map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
      </div>
      {foreign.length > 0 && (
        <ul className="rows" style={{ marginBottom: 24 }}>
          {foreign.map((c) => (
            <li key={c}><div className="row"><span>1 EUR</span><span className="detail">{data.rates[c] ? `${data.rates[c].toLocaleString('en', { maximumFractionDigits: 4 })} ${c}` : 'No rate yet'}</span></div></li>
          ))}
        </ul>
      )}
      <p className="small muted">Rates are the ECB's daily reference rates. For other currencies, set your own rate:</p>
      <div className="grid2" style={{ gridTemplateColumns: '100px 1fr auto', alignItems: 'end' }}>
        <label className="field"><span>Currency</span>
          <select className="input" value={manualCur} onChange={(e) => setManualCur(e.target.value)}>
            {COMMON_CURRENCIES.filter((c) => !ECB_CURRENCIES.includes(c)).map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Units per 1 EUR{data.rates[manualCur] ? ` · now ${data.rates[manualCur]}` : ''}</span><input className="input" inputMode="decimal" value={manualRate} onChange={(e) => setManualRate(e.target.value)} placeholder="27500" /></label>
        <button className="link field" onClick={() => {
          const rate = Number(manualRate.replace(',', '.'));
          if (rate > 0) setRate.mutate({ currency: manualCur, rate }, { onSuccess: () => { toast(`${manualCur} rate saved`); setManualRate(''); }, onError: (e) => toast(e.message) });
        }}>Save</button>
      </div>
    </section>
  );
}

function Data() {
  return (
    <section className="section" id="data">
      <div className="meta"><span>Your data</span></div>
      <ul className="rows">
        <li><a className="row" href="/api/export.json" download><span className="name">Export everything</span><span className="detail">JSON<span className="arrow">↓</span></span></a></li>
        <li><a className="row" href="/api/export.csv" download><span className="name">Export transactions</span><span className="detail">CSV<span className="arrow">↓</span></span></a></li>
      </ul>
      <p className="small muted">The database is backed up every night to a private GitHub repository, and Cloudflare keeps a 7-day restore history.</p>
    </section>
  );
}

function Account() {
  const toast = useToast();
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<{ email: string; name: string | null }>('/api/me') });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const change = useWrite(() => post('/auth/password', { current, next }));
  const signOut = async () => {
    await post('/auth/logout').catch(() => undefined);
    location.href = '/';
  };
  return (
    <section className="section" id="account">
      <div className="meta"><span>Account</span></div>
      <ul className="rows">
        <li><div className="row"><span className="name">{me.data?.email ?? '—'}</span><button className="link muted" onClick={signOut}>Sign out</button></div></li>
      </ul>
      <form style={{ marginTop: 28 }} onSubmit={(e) => {
        e.preventDefault();
        setError('');
        change.mutate(undefined, { onSuccess: () => { toast('Password changed. Other devices were signed out.'); setCurrent(''); setNext(''); }, onError: (err) => setError(err.message) });
      }}>
        <input type="email" autoComplete="username" value={me.data?.email ?? ''} readOnly hidden />
        <div className="grid2">
          <label className="field"><span>Current password</span><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
          <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="link" disabled={change.isPending}>Change password</button>
      </form>
    </section>
  );
}
