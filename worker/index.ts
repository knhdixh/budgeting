import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { and, eq, lte } from 'drizzle-orm';
import { api, postSchedule, today } from './api';
import { authRoutes } from './auth';
import { getDb } from './db/client';
import { accounts, schedules } from './db/schema';
import type { AppEnv, Env } from './env';
import { fetchRates, MissingRateError } from './fx';
import { HttpError } from './ledger';

const app = new Hono<AppEnv>();

// One canonical host, so cookies and the OAuth callback live in one place.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname.endsWith('.workers.dev') && c.env.CANONICAL_HOST) {
    url.hostname = c.env.CANONICAL_HOST;
    return c.redirect(url.toString(), c.req.method === 'GET' || c.req.method === 'HEAD' ? 301 : 308);
  }
  await next();
});

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
    connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    frameAncestors: ["'none'"],
    formAction: ["'self'", 'https://accounts.google.com'],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
  },
  strictTransportSecurity: 'max-age=63072000; includeSubDomains',
  referrerPolicy: 'strict-origin-when-cross-origin',
  crossOriginOpenerPolicy: 'same-origin',
}));

// Writes must come from our own pages (SameSite cookies plus an Origin check).
app.use('*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (!origin || origin !== new URL(c.req.url).origin) return c.json({ error: 'Cross-origin request blocked' }, 403);
  }
  c.set('db', getDb(c.env.DB));
  await next();
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/auth/')) c.header('cache-control', 'no-store');
});

app.route('/auth', authRoutes);
app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof MissingRateError) return c.json({ error: err.message }, 400);
  if (err.name === 'ZodError') return c.json({ error: 'Invalid input' }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

/** Daily: refresh exchange rates and post scheduled transactions that are due and set to auto-post. */
export async function runDaily(env: Env) {
  const db = getDb(env.DB);
  const currencies = [...new Set((await db.select({ c: accounts.currency }).from(accounts).all()).map((r) => r.c))];
  const t = await today(db);
  await fetchRates(db, currencies, t, t).catch((e) => console.error('rates', e));
  const due = await db.select({ id: schedules.id }).from(schedules).where(and(eq(schedules.autoPost, true), lte(schedules.nextDate, t))).all();
  for (const s of due) await postSchedule(db, s.id, t).catch((e) => console.error('schedule', s.id, e));
}

export default {
  fetch: app.fetch,
  scheduled: (_event, env, ctx) => ctx.waitUntil(runDaily(env)),
} satisfies ExportedHandler<Env>;

export { app };
