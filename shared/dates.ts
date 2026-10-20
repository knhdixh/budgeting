// Calendar maths on 'YYYY-MM-DD' strings, done in UTC so time zones never shift a day.

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function parseISODate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Today's date in an IANA zone. */
export function todayIn(timeZone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function monthOf(date: string) {
  return date.slice(0, 7);
}

export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

export function monthsBetween(from: string, to: string) {
  const [y1, m1] = from.split('-').map(Number);
  const [y2, m2] = to.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function lastDayOfMonth(month: string) {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
}

export function addDays(date: string, n: number) {
  const d = parseISODate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toISODate(d);
}

/**
 * The n-th occurrence (0 = start) of a schedule. Monthly and yearly keep the start's day of month,
 * clamped to the month's length, so the 31st becomes the 30th or 28th/29th, then returns to the 31st.
 */
export function occurrence(start: string, frequency: Frequency, interval: number, n: number) {
  const step = n * interval;
  if (frequency === 'daily') return addDays(start, step);
  if (frequency === 'weekly') return addDays(start, step * 7);
  const months = frequency === 'monthly' ? step : step * 12;
  const day = Number(start.slice(8, 10));
  const month = addMonths(monthOf(start), months);
  const last = Number(lastDayOfMonth(month).slice(8, 10));
  return `${month}-${pad(Math.min(day, last))}`;
}

/** First occurrence strictly after `after`. */
export function nextOccurrence(start: string, frequency: Frequency, interval: number, after: string) {
  if (start > after) return start;
  // Estimate the index, then walk forward; avoids looping from the start for old schedules.
  const days = (parseISODate(after).getTime() - parseISODate(start).getTime()) / 86400000;
  const approxPeriod = { daily: 1, weekly: 7, monthly: 30.44, yearly: 365.25 }[frequency] * interval;
  let n = Math.max(0, Math.floor(days / approxPeriod) - 1);
  while (occurrence(start, frequency, interval, n) <= after) n++;
  return occurrence(start, frequency, interval, n);
}

export function formatMonth(month: string, style: 'long' | 'short' = 'long') {
  return parseISODate(`${month}-01`).toLocaleDateString('en-GB', { month: style, year: 'numeric', timeZone: 'UTC' });
}

export function formatDate(date: string, withYear = false) {
  return parseISODate(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}
