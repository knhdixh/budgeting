// Email + password sign-in for an allowlist of accounts, with server-side sessions in D1.
//
// - Only emails in ALLOWED_EMAILS (a secret) can sign in. Each has one password, stored in
//   settings as a salted PBKDF2 hash.
// - Passwords are first set (or reset) through a one-time link: /setup#<SETUP_TOKEN>. The token is a
//   Worker secret; once used, its hash is recorded so the same link never works twice.
// - Failed attempts are rate-limited per IP and overall.
// - The session cookie holds a random token; D1 stores only its SHA-256.

import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { loginAttempts, sessions, settings, users } from './db/schema';
import type { AppEnv, DB, Env, SessionUser } from './env';
import { MIN_PASSWORD_LENGTH, hashPassword, timingSafeEqual, verifyPassword } from './password';

const SESSION_DAYS = 30;
const RENEW_WHEN_DAYS_LEFT = 15;
const IP_FAILURES = { max: 5, windowMs: 15 * 60_000 };
const ALL_FAILURES = { max: 30, windowMs: 60 * 60_000 };
// Verified against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const isSecure = (c: Context) => new URL(c.req.url).protocol === 'https:';
const sessionCookie = (c: Context) => (isSecure(c) ? '__Host-session' : 'session');
const clientIp = (c: Context) => c.req.header('cf-connecting-ip') ?? 'local';

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function allowedEmails(env: Env) {
  return (env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

const passwordKey = (email: string) => `password:${email}`;

async function getPasswordHash(db: DB, email: string) {
  return (await db.select().from(settings).where(eq(settings.key, passwordKey(email))).get())?.value ?? null;
}

async function setPassword(db: DB, email: string, password: string) {
  const value = await hashPassword(password);
  await db.insert(settings).values({ key: passwordKey(email), value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

async function startSession(c: Context<AppEnv>, userId: string) {
  const token = randomToken();
  await c.var.db.insert(sessions).values({
    id: await sha256(token),
    userId,
    expiresAt: Date.now() + SESSION_DAYS * 86400_000,
    userAgent: c.req.header('user-agent')?.slice(0, 200) ?? null,
  });
  setCookie(c, sessionCookie(c), token, {
    path: '/', httpOnly: true, secure: isSecure(c), sameSite: 'Lax', maxAge: SESSION_DAYS * 86400,
  });
}

async function userFor(db: DB, email: string) {
  const subject = `email:${email}`;
  const existing = await db.select().from(users).where(eq(users.subject, subject)).get();
  if (existing) return existing.id;
  const [row] = await db.insert(users).values({ subject, email }).returning({ id: users.id });
  return row.id;
}

export async function currentUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, sessionCookie(c));
  if (!token) return null;
  const id = await sha256(token);
  const row = await c.var.db
    .select({ expiresAt: sessions.expiresAt, id: users.id, email: users.email, name: users.name, picture: users.picture })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id)).get();
  if (!row) return null;
  if (row.expiresAt < Date.now() || !allowedEmails(c.env).includes(row.email.toLowerCase())) {
    await c.var.db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  // Sliding expiry: renew quietly once half the session has passed.
  if (row.expiresAt - Date.now() < RENEW_WHEN_DAYS_LEFT * 86400_000) {
    await c.var.db.update(sessions).set({ expiresAt: Date.now() + SESSION_DAYS * 86400_000 }).where(eq(sessions.id, id));
    setCookie(c, sessionCookie(c), token, {
      path: '/', httpOnly: true, secure: isSecure(c), sameSite: 'Lax', maxAge: SESSION_DAYS * 86400,
    });
  }
  return { id: row.id, email: row.email, name: row.name, picture: row.picture };
}

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'Sign in required' }, 401);
  c.set('user', user);
  await next();
};

/** Returns a message when this IP (or everyone together) has failed too often recently. */
async function rateLimited(db: DB, ip: string) {
  const now = Date.now();
  const count = async (since: number, ipOnly: boolean) => (await db.select({ n: sql<number>`count(*)` }).from(loginAttempts)
    .where(and(eq(loginAttempts.ok, false), gt(loginAttempts.at, since), ipOnly ? eq(loginAttempts.ip, ip) : undefined)).get())?.n ?? 0;
  if (await count(now - IP_FAILURES.windowMs, true) >= IP_FAILURES.max) return 'Too many attempts. Try again in 15 minutes.';
  if (await count(now - ALL_FAILURES.windowMs, false) >= ALL_FAILURES.max) return 'Sign-in is paused for a while after too many failed attempts.';
  return null;
}

async function recordAttempt(db: DB, ip: string, ok: boolean) {
  await db.insert(loginAttempts).values({ ip, at: Date.now(), ok });
  await db.delete(loginAttempts).where(lt(loginAttempts.at, Date.now() - 86400_000));
}

const loginInput = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().min(1).max(500) });
const setupInput = z.object({ token: z.string().min(16).max(200), email: z.string().trim().toLowerCase().max(200), password: z.string().max(500) });
const changeInput = z.object({ current: z.string().min(1).max(500), next: z.string().max(500) });

async function json<T extends z.ZodType>(c: Context, schema: T) {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  return parsed.success ? (parsed.data as z.output<T>) : null;
}

const tooShort = (p: string) => p.length < MIN_PASSWORD_LENGTH;

export const authRoutes = new Hono<AppEnv>()
  .post('/login', async (c) => {
    const db = c.var.db;
    const ip = clientIp(c);
    const limited = await rateLimited(db, ip);
    if (limited) return c.json({ error: limited }, 429);
    const input = await json(c, loginInput);
    if (!input) return c.json({ error: 'Enter your email and password.' }, 400);
    const allowed = allowedEmails(c.env).includes(input.email);
    const hash = allowed ? await getPasswordHash(db, input.email) : null;
    const ok = (await verifyPassword(input.password, hash ?? DUMMY_HASH)) && allowed && !!hash;
    await recordAttempt(db, ip, ok);
    if (!ok) return c.json({ error: 'Wrong email or password.' }, 401);
    await startSession(c, await userFor(db, input.email));
    return c.json({ ok: true });
  })
  // Sets or resets a password with the one-time setup token, then signs in everywhere afresh.
  .post('/setup', async (c) => {
    const db = c.var.db;
    const ip = clientIp(c);
    const limited = await rateLimited(db, ip);
    if (limited) return c.json({ error: limited }, 429);
    const input = await json(c, setupInput);
    const expected = c.env.SETUP_TOKEN;
    const enc = new TextEncoder();
    const tokenOk = !!input && !!expected && timingSafeEqual(enc.encode(input.token), enc.encode(expected));
    const usedHash = (await db.select().from(settings).where(eq(settings.key, 'setup_token_used')).get())?.value;
    if (!input || !tokenOk || (usedHash && usedHash === await sha256(input.token))) {
      await recordAttempt(db, ip, false);
      return c.json({ error: 'This setup link is invalid or has already been used.' }, 403);
    }
    if (!allowedEmails(c.env).includes(input.email)) return c.json({ error: 'This email has no access.' }, 403);
    if (tooShort(input.password)) return c.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    await setPassword(db, input.email, input.password);
    await db.insert(settings).values({ key: 'setup_token_used', value: await sha256(input.token) })
      .onConflictDoUpdate({ target: settings.key, set: { value: await sha256(input.token) } });
    const userId = await userFor(db, input.email);
    await db.delete(sessions).where(eq(sessions.userId, userId));
    await recordAttempt(db, ip, true);
    await startSession(c, userId);
    return c.json({ ok: true });
  })
  .post('/password', requireUser, async (c) => {
    const db = c.var.db;
    const input = await json(c, changeInput);
    if (!input) return c.json({ error: 'Enter both passwords.' }, 400);
    const email = c.var.user.email.toLowerCase();
    const hash = await getPasswordHash(db, email);
    if (!hash || !(await verifyPassword(input.current, hash))) return c.json({ error: 'Current password is wrong.' }, 403);
    if (tooShort(input.next)) return c.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    await setPassword(db, email, input.next);
    // Sign out every other device.
    const token = getCookie(c, sessionCookie(c))!;
    await db.delete(sessions).where(and(eq(sessions.userId, c.var.user.id), sql`${sessions.id} != ${await sha256(token)}`));
    return c.json({ ok: true });
  })
  .post('/logout', async (c) => {
    const token = getCookie(c, sessionCookie(c));
    if (token) await c.var.db.delete(sessions).where(eq(sessions.id, await sha256(token)));
    deleteCookie(c, sessionCookie(c), { path: '/', secure: isSecure(c) });
    return c.json({ ok: true });
  })
  // Local development only: sign in as the first allowed email without a password.
  .get('/dev', async (c) => {
    const host = new URL(c.req.url).hostname;
    if (c.env.DEV_LOGIN !== '1' || (host !== 'localhost' && host !== '127.0.0.1')) return c.notFound();
    await startSession(c, await userFor(c.var.db, allowedEmails(c.env)[0]));
    return c.redirect('/', 302);
  });
