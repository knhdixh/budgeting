// Google sign-in for an allowlist of accounts, with server-side sessions in D1.
//
// - OAuth 2.0 authorization code flow with PKCE and a state cookie (arctic).
// - The ID token comes straight from Google's token endpoint over TLS, so its claims are trusted
//   (OIDC Core §3.1.3.7); we still check issuer, audience and expiry.
// - Only verified emails in ALLOWED_EMAILS get in. The first sign-in pins the Google account ID,
//   so a different Google account can never claim the same email later.
// - The session cookie holds a random token; D1 stores only its SHA-256.

import { Google, decodeIdToken, generateCodeVerifier, generateState } from 'arctic';
import { eq } from 'drizzle-orm';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sessions, users } from './db/schema';
import type { AppEnv, Env, SessionUser } from './env';

const SESSION_DAYS = 30;
const RENEW_WHEN_DAYS_LEFT = 15;

const isSecure = (c: Context) => new URL(c.req.url).protocol === 'https:';
const sessionCookie = (c: Context) => (isSecure(c) ? '__Host-session' : 'session');

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

function google(c: Context<AppEnv>) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null;
  return new Google(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, `${new URL(c.req.url).origin}/auth/google/callback`);
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

async function upsertUser(c: Context<AppEnv>, claims: { sub: string; email: string; name?: string; picture?: string }) {
  const db = c.var.db;
  const bySub = await db.select().from(users).where(eq(users.googleSub, claims.sub)).get();
  if (bySub) {
    await db.update(users).set({ email: claims.email, name: claims.name ?? null, picture: claims.picture ?? null }).where(eq(users.id, bySub.id));
    return bySub.id;
  }
  const byEmail = await db.select().from(users).where(eq(users.email, claims.email)).get();
  if (byEmail) return null; // same email, different Google account: refuse
  const [row] = await db.insert(users).values({
    googleSub: claims.sub, email: claims.email, name: claims.name ?? null, picture: claims.picture ?? null,
  }).returning({ id: users.id });
  return row.id;
}

const denied = (c: Context<AppEnv>, reason: string) => c.redirect(`/?error=${encodeURIComponent(reason)}`, 302);

export const authRoutes = new Hono<AppEnv>()
  .get('/google', (c) => {
    const g = google(c);
    if (!g) return c.text('Google sign-in is not configured.', 503);
    const state = generateState();
    const verifier = generateCodeVerifier();
    const url = g.createAuthorizationURL(state, verifier, ['openid', 'email', 'profile']);
    url.searchParams.set('prompt', 'select_account');
    const opts = { path: '/auth', httpOnly: true, secure: isSecure(c), sameSite: 'Lax' as const, maxAge: 600 };
    setCookie(c, 'oauth_state', state, opts);
    setCookie(c, 'oauth_verifier', verifier, opts);
    return c.redirect(url.toString(), 302);
  })
  .get('/google/callback', async (c) => {
    const g = google(c);
    if (!g) return c.text('Google sign-in is not configured.', 503);
    const { code, state } = c.req.query();
    const savedState = getCookie(c, 'oauth_state');
    const verifier = getCookie(c, 'oauth_verifier');
    deleteCookie(c, 'oauth_state', { path: '/auth' });
    deleteCookie(c, 'oauth_verifier', { path: '/auth' });
    if (!code || !state || !savedState || !verifier || state !== savedState) return denied(c, 'Sign-in expired. Try again.');

    let claims: Record<string, unknown>;
    try {
      const tokens = await g.validateAuthorizationCode(code, verifier);
      claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
    } catch {
      return denied(c, 'Google sign-in failed. Try again.');
    }
    const email = String(claims.email ?? '').toLowerCase();
    const validIssuer = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    const fresh = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();
    if (!validIssuer || claims.aud !== c.env.GOOGLE_CLIENT_ID || !fresh || typeof claims.sub !== 'string') {
      return denied(c, 'Google sign-in failed. Try again.');
    }
    if (claims.email_verified !== true || !allowedEmails(c.env).includes(email)) {
      return denied(c, 'This Google account has no access.');
    }
    const userId = await upsertUser(c, {
      sub: claims.sub, email, name: claims.name as string | undefined, picture: claims.picture as string | undefined,
    });
    if (!userId) return denied(c, 'This Google account has no access.');
    await startSession(c, userId);
    return c.redirect('/', 302);
  })
  .post('/logout', async (c) => {
    const token = getCookie(c, sessionCookie(c));
    if (token) await c.var.db.delete(sessions).where(eq(sessions.id, await sha256(token)));
    deleteCookie(c, sessionCookie(c), { path: '/', secure: isSecure(c) });
    return c.json({ ok: true });
  })
  // Local development only: sign in as the first allowed email without Google.
  .get('/dev', async (c) => {
    const host = new URL(c.req.url).hostname;
    if (c.env.DEV_LOGIN !== '1' || (host !== 'localhost' && host !== '127.0.0.1')) return c.notFound();
    const email = allowedEmails(c.env)[0];
    const userId = await upsertUser(c, { sub: `dev:${email}`, email, name: 'Dev' }) ??
      (await c.var.db.select().from(users).where(eq(users.email, email)).get())!.id;
    await startSession(c, userId);
    return c.redirect('/', 302);
  });
