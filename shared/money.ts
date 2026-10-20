// Amounts are integer cents everywhere. Display uses Intl for symbols and grouping.

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, signDisplay: 'auto' | 'always' | 'exceptZero' = 'auto') {
  const key = `${currency}:${signDisplay}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-IE', { style: 'currency', currency, signDisplay, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(cents: number, currency = 'EUR', opts: { sign?: boolean } = {}) {
  return formatter(currency, opts.sign ? 'exceptZero' : 'auto').format(cents / 100).replace('-', '−');
}

/** Plain number for inputs: 1234.5 → "1234.50". */
export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2);
}

/**
 * Parses what people type: "12", "12.5", "12,50", "1 234,56", "1,234.56", "-8", "€ 12".
 * Also evaluates simple sums like "12.40+3" so amounts can be split in the field.
 * Returns cents, or null when the text isn't a number.
 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[^\d.,+\-−\s]/g, '').replace(/−/g, '-').replace(/\s/g, '');
  if (!s) return null;
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms) return null;
  let total = 0;
  for (const term of terms) {
    const v = parseTerm(term);
    if (v === null) return null;
    total += v;
  }
  return total;
}

function parseTerm(term: string): number | null {
  let sign = 1;
  let t = term;
  if (t.startsWith('-')) { sign = -1; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
  if (!t) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  const sepIdx = Math.max(lastDot, lastComma);
  let intPart = t;
  let frac = '';
  // The last separator is decimal when it has 1–2 digits after it; otherwise it groups thousands.
  if (sepIdx >= 0 && t.length - sepIdx - 1 <= 2) {
    intPart = t.slice(0, sepIdx);
    frac = t.slice(sepIdx + 1);
  }
  intPart = intPart.replace(/[.,]/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac) || (intPart === '' && frac === '')) return null;
  return sign * (Number(intPart || '0') * 100 + Number(frac.padEnd(2, '0') || '0'));
}

/** ECB reference currencies (Frankfurter) plus EUR. Others need a manual rate. */
export const ECB_CURRENCIES = [
  'EUR', 'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK',
  'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
];

export const COMMON_CURRENCIES = [...ECB_CURRENCIES, 'VND', 'AED', 'TWD', 'UAH'].sort();

/** rateX = units of X per 1 EUR. */
export function convert(cents: number, fromRate: number, toRate: number) {
  return Math.round((cents * toRate) / fromRate);
}
