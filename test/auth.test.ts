import { describe, expect, it } from 'vitest';
import { app } from '../worker/index';
import { hashPassword, verifyPassword } from '../worker/password';
import { setup } from './helpers';

const TOKEN = 'setup-token-0123456789abcdef';
const PASSWORD = 'correct horse battery';

async function anon(env: any, path: string, body: unknown, ip = '1.2.3.4', cookie = '') {
  const res = await app.request(`http://localhost${path}`, {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/json', 'cf-connecting-ip': ip, cookie },
    body: JSON.stringify(body),
  }, env);
  return { status: res.status, json: await res.json() as any, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}

describe('passwords', () => {
  it('hashes with a salt and verifies', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword('wrong', a)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'garbage')).toBe(false);
  });
});

describe('email sign-in', () => {
  it('sets a password with the setup link once, then signs in', async () => {
    const { env } = await setup();
    const short = await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: 'short' });
    expect(short.status).toBe(400);
    const ok = await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.cookie).toMatch(/^session=/);
    const again = await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: 'another long password' });
    expect(again.status).toBe(403);

    const login = await anon(env, '/auth/login', { email: 'ME@example.com ', password: PASSWORD });
    expect(login.status).toBe(200);
    const me = await app.request('http://localhost/api/me', { headers: { cookie: login.cookie } }, env);
    expect(((await me.json()) as any).email).toBe('me@example.com');
  });

  it('rejects wrong tokens, unknown emails and wrong passwords', async () => {
    const { env } = await setup();
    expect((await anon(env, '/auth/setup', { token: 'x'.repeat(28), email: 'me@example.com', password: PASSWORD })).status).toBe(403);
    expect((await anon(env, '/auth/setup', { token: TOKEN, email: 'other@example.com', password: PASSWORD })).status).toBe(403);
    await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: PASSWORD });
    expect((await anon(env, '/auth/login', { email: 'me@example.com', password: 'wrong password!' })).status).toBe(401);
    expect((await anon(env, '/auth/login', { email: 'other@example.com', password: PASSWORD })).status).toBe(401);
  });

  it('says when no password exists yet instead of counting failures', async () => {
    const { env } = await setup();
    const status = await app.request('http://localhost/auth/status', {}, env);
    expect(await status.json()).toEqual({ needsSetup: true });
    for (let i = 0; i < 12; i++) expect((await anon(env, '/auth/login', { email: 'me@example.com', password: 'anything at all' })).status).toBe(409);
    expect((await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: PASSWORD })).status).toBe(200);
    expect(await (await app.request('http://localhost/auth/status', {}, env)).json()).toEqual({ needsSetup: false });
  });

  it('cannot set up without a configured token', async () => {
    const { env } = await setup({ SETUP_TOKEN: undefined });
    expect((await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: PASSWORD })).status).toBe(403);
  });

  it('locks an IP out after repeated failures', async () => {
    const { env } = await setup();
    await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: PASSWORD });
    for (let i = 0; i < 10; i++) await anon(env, '/auth/login', { email: 'me@example.com', password: `guess ${i}` }, '9.9.9.9');
    expect((await anon(env, '/auth/login', { email: 'me@example.com', password: PASSWORD }, '9.9.9.9')).status).toBe(429);
    expect((await anon(env, '/auth/login', { email: 'me@example.com', password: PASSWORD }, '8.8.8.8')).status).toBe(200);
  });

  it('changes the password and signs out other sessions', async () => {
    const { env } = await setup();
    await anon(env, '/auth/setup', { token: TOKEN, email: 'me@example.com', password: PASSWORD });
    const a = await anon(env, '/auth/login', { email: 'me@example.com', password: PASSWORD });
    const b = await anon(env, '/auth/login', { email: 'me@example.com', password: PASSWORD });
    expect((await anon(env, '/auth/password', { current: 'nope', next: 'a brand new password' }, '1.2.3.4', a.cookie)).status).toBe(403);
    expect((await anon(env, '/auth/password', { current: PASSWORD, next: 'a brand new password' }, '1.2.3.4', a.cookie)).status).toBe(200);
    expect((await app.request('http://localhost/api/me', { headers: { cookie: a.cookie } }, env)).status).toBe(200);
    expect((await app.request('http://localhost/api/me', { headers: { cookie: b.cookie } }, env)).status).toBe(401);
    expect((await anon(env, '/auth/login', { email: 'me@example.com', password: 'a brand new password' })).status).toBe(200);
  });

  it('refuses cross-origin login attempts', async () => {
    const { env } = await setup();
    const res = await app.request('http://localhost/auth/login', { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }, env);
    expect(res.status).toBe(403);
  });
});
