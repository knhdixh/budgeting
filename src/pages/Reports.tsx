import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addMonths, formatMonth, lastDayOfMonth } from '../../shared/dates';
import { get } from '../api';
import { Title } from '../components/Shell';
import { useLookups } from '../data';
import { money, thisMonth } from '../util';

const RANGES = { month: 'This month', last: 'Last month', '3m': '3 months', '12m': '12 months', ytd: 'Year to date' } as const;
type Range = keyof typeof RANGES;

function rangeDates(r: Range) {
  const m = thisMonth();
  switch (r) {
    case 'month': return [`${m}-01`, lastDayOfMonth(m)];
    case 'last': { const p = addMonths(m, -1); return [`${p}-01`, lastDayOfMonth(p)]; }
    case '3m': return [`${addMonths(m, -2)}-01`, lastDayOfMonth(m)];
    case '12m': return [`${addMonths(m, -11)}-01`, lastDayOfMonth(m)];
    case 'ytd': return [`${m.slice(0, 4)}-01-01`, lastDayOfMonth(m)];
  }
}

const axisMoney = (v: number) => {
  const n = Math.abs(v / 100);
  return `${v < 0 ? '−' : ''}${n >= 1000 ? `${Math.round(n / 100) / 10}k` : Math.round(n)}`;
};
const tooltipStyle = { border: 0, boxShadow: '0 0 0 1px #e6e6e6', borderRadius: 0, fontSize: 13, fontFamily: 'Inter, system-ui, sans-serif' };

export default function ReportsPage() {
  const { base, category } = useLookups();
  const [range, setRange] = useState<Range>('month');
  const [from, to] = rangeDates(range);
  const spending = useQuery({ queryKey: ['reports', 'spending', from, to], queryFn: () => get<{ categories: { categoryId: string; total: number }[]; payees: { payee: string; total: number }[] }>(`/api/reports/spending?from=${from}&to=${to}`) });
  const cashflow = useQuery({ queryKey: ['reports', 'cashflow'], queryFn: () => get<{ month: string; income: number; expense: number }[]>('/api/reports/cashflow?months=12') });
  const networth = useQuery({ queryKey: ['reports', 'networth'], queryFn: () => get<{ month: string; assets: number; debts: number; net: number }[]>('/api/reports/networth?months=12') });

  const cats = (spending.data?.categories ?? []).filter((c) => c.total < 0);
  const total = cats.reduce((s, c) => s + c.total, 0);
  const max = Math.max(...cats.map((c) => -c.total), 1);
  const flow = (cashflow.data ?? []).map((r) => ({ ...r, label: formatMonth(r.month, 'short').split(' ')[0] }));
  const income12 = flow.reduce((s, r) => s + r.income, 0);
  const expense12 = flow.reduce((s, r) => s + r.expense, 0);
  const nw = (networth.data ?? []).map((r) => ({ ...r, label: formatMonth(r.month, 'short').split(' ')[0] }));

  return (
    <main className="page">
      <Title>Reports</Title>

      <section className="section">
        <div className="meta">
          <span>Spending</span>
          <select className="input" style={{ width: 'auto', fontSize: 13, padding: '0 20px 0 0', color: 'var(--muted)' }} value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Range">
            {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="stats" style={{ marginBottom: 32 }}>
          <div className="stat"><div className="value">{money(-total, base)}</div><div className="label">Spent · {RANGES[range].toLowerCase()}</div></div>
        </div>
        {!cats.length && !spending.isLoading && <p className="empty">No spending in this period.</p>}
        <ul className="rows">
          {cats.map((c, i) => (
            <li key={c.categoryId} style={{ ['--i' as string]: i }}>
              <Link className="spend-row" to={`/transactions?category=${c.categoryId}&from=${from}&to=${to}`} style={{ textDecoration: 'none' }}>
                <span className="name" style={{ fontWeight: 500 }}>{category(c.categoryId)?.name ?? 'Deleted'} <span className="muted small">{Math.round((c.total / total) * 100)}%</span></span>
                <span className="right num">{money(-c.total, base)}</span>
                <span className="bar" aria-hidden><i style={{ width: `${(-c.total / max) * 100}%` }} /></span>
              </Link>
            </li>
          ))}
        </ul>
        {spending.data?.payees.length ? (
          <>
            <div className="meta" style={{ marginTop: 48 }}><span>Top payees</span></div>
            <ul className="rows">
              {spending.data.payees.map((p, i) => (
                <li key={p.payee} style={{ ['--i' as string]: i }}><div className="row"><span className="name">{p.payee}</span><span className="detail">{money(-p.total, base)}</span></div></li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="section">
        <div className="meta"><span>Income and spending · 12 months</span><span className="legend"><span><i style={{ background: '#000' }} />In</span><span><i style={{ background: '#c8c8c8' }} />Out</span></span></div>
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat"><div className="value small-value">{money(income12 - expense12, base, true)}</div><div className="label">Saved · {income12 ? Math.round(((income12 - expense12) / income12) * 100) : 0}% of income</div></div>
        </div>
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={flow} barGap={2} margin={{ left: -12, right: 0, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e6e6e6" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={48} />
              <Tooltip cursor={{ fill: '#f6f6f6' }} contentStyle={tooltipStyle} formatter={(v) => money(Number(v), base)} />
              <Bar dataKey="income" name="In" fill="#000" isAnimationActive={false} />
              <Bar dataKey="expense" name="Out" fill="#c8c8c8" isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="section">
        <div className="meta"><span>Net worth · 12 months</span><span className="num">{nw.length ? money(nw[nw.length - 1].net, base) : ''}</span></div>
        <div className="chart">
          <ResponsiveContainer>
            <LineChart data={nw} margin={{ left: -12, right: 4, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e6e6e6" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={48} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v), base)} />
              <Line type="monotone" dataKey="net" name="Net worth" stroke="#000" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="debts" name="Debts" stroke="#c8c8c8" strokeWidth={1} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </main>
  );
}
