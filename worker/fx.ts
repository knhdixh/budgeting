// Exchange rates: daily ECB reference rates from Frankfurter (free, no key), cached in D1.
// Rates are stored as units of the currency per 1 EUR. Currencies the ECB doesn't publish use a
// manual rate (date '0000-00-00') set in settings.

import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { ECB_CURRENCIES, convert } from '../shared/money';
import { addDays } from '../shared/dates';
import { fxRates, settings } from './db/schema';
import type { DB } from './env';

export const MANUAL = '0000-00-00';
const API = 'https://api.frankfurter.dev/v1';

export class MissingRateError extends Error {
  constructor(public currency: string) {
    super(`No exchange rate for ${currency}. Set one in settings.`);
  }
}

export async function baseCurrency(db: DB) {
  const row = await db.select().from(settings).where(eq(settings.key, 'base_currency')).get();
  return row?.value ?? 'EUR';
}

/** Fetches and stores ECB rates for a date range (one request per call). */
export async function fetchRates(db: DB, currencies: string[], from: string, to: string) {
  const symbols = currencies.filter((c) => c !== 'EUR' && ECB_CURRENCIES.includes(c));
  if (!symbols.length) return;
  const path = from === to ? from : `${from}..${to}`;
  const res = await fetch(`${API}/${path}?base=EUR&symbols=${symbols.join(',')}`);
  if (!res.ok) throw new Error(`Exchange rates unavailable (${res.status})`);
  const body = (await res.json()) as { date?: string; rates: Record<string, number> | Record<string, Record<string, number>> };
  const rows: { date: string; currency: string; rate: number }[] = [];
  if (body.date) {
    for (const [currency, rate] of Object.entries(body.rates as Record<string, number>)) rows.push({ date: body.date, currency, rate });
  } else {
    for (const [date, rates] of Object.entries(body.rates as Record<string, Record<string, number>>)) {
      for (const [currency, rate] of Object.entries(rates)) rows.push({ date, currency, rate });
    }
  }
  // json_each keeps this to one statement regardless of the number of rows.
  for (let i = 0; i < rows.length; i += 500) {
    await db.run(sql`INSERT OR REPLACE INTO fx_rates (date, currency, rate)
      SELECT value->>'date', value->>'currency', value->>'rate' FROM json_each(${JSON.stringify(rows.slice(i, i + 500))})`);
  }
}

/** A resolver that answers "rate of X on date D" from memory after one query per currency. */
export async function rateBook(db: DB, currencies: string[], from: string, to: string) {
  const needed = [...new Set(currencies)].filter((c) => c !== 'EUR');
  const book = new Map<string, { dates: string[]; rates: number[]; manual?: number }>();
  if (needed.length) {
    // Make sure ECB currencies have rates covering [from − 7 days, to].
    const ecb = needed.filter((c) => ECB_CURRENCIES.includes(c));
    if (ecb.length) {
      const have = await db.select({ currency: fxRates.currency, min: sql<string>`min(date)`, max: sql<string>`max(date)` })
        .from(fxRates).where(and(inArray(fxRates.currency, ecb), sql`date != ${MANUAL}`)).groupBy(fxRates.currency).all();
      const today = new Date().toISOString().slice(0, 10);
      const end = to > today ? today : to;
      const start = addDays(from > end ? end : from, -7);
      const missing = ecb.filter((c) => {
        const h = have.find((r) => r.currency === c);
        return !h || h.min > start || h.max < addDays(end, -4);
      });
      if (missing.length) await fetchRates(db, missing, start, end).catch(() => undefined);
    }
    const rows = await db.select().from(fxRates).where(inArray(fxRates.currency, needed)).orderBy(fxRates.currency, fxRates.date).all();
    for (const r of rows) {
      const e = book.get(r.currency) ?? { dates: [], rates: [] };
      if (r.date === MANUAL) e.manual = r.rate;
      else { e.dates.push(r.date); e.rates.push(r.rate); }
      book.set(r.currency, e);
    }
  }
  const rate = (currency: string, date: string) => {
    if (currency === 'EUR') return 1;
    const e = book.get(currency);
    if (!e) throw new MissingRateError(currency);
    if (e.manual !== undefined) return e.manual;
    // Latest rate on or before the date (weekends and holidays use the previous business day).
    let lo = 0, hi = e.dates.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (e.dates[mid] <= date) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found === -1) {
      if (!e.rates.length) throw new MissingRateError(currency);
      return e.rates[0];
    }
    return e.rates[found];
  };
  return {
    rate,
    convert: (cents: number, from: string, to: string, date: string) => (from === to ? cents : convert(cents, rate(from, date), rate(to, date))),
  };
}

export type RateBook = Awaited<ReturnType<typeof rateBook>>;

export async function latestRates(db: DB, currencies: string[]) {
  const out: Record<string, number> = { EUR: 1 };
  for (const c of currencies) {
    if (c === 'EUR') continue;
    const row = await db.select().from(fxRates).where(and(eq(fxRates.currency, c), lte(fxRates.date, '9999-12-31')))
      .orderBy(sql`date = ${MANUAL} DESC`, desc(fxRates.date)).limit(1).get();
    if (row) out[c] = row.rate;
  }
  return out;
}
