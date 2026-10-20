import { app } from '../worker/index';
import type { Env } from '../worker/env';
import { createD1 } from './d1';

export async function setup(overrides: Partial<Env> = {}) {
  const env = {
    DB: createD1(),
    CANONICAL_HOST: 'budgeting.knhdixh.com',
    ALLOWED_EMAILS: 'me@example.com',
    DEV_LOGIN: '1',
    ...overrides,
  } as Env;
  const login = await app.request('http://localhost/auth/dev', {}, env);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`http://localhost${path}`, {
      method,
      headers: { cookie, origin: 'http://localhost', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }, env);
    const text = await res.text();
    let json: any = text;
    try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, json, headers: res.headers };
  };
  return {
    env, cookie, call,
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    put: (p: string, b: unknown) => call('PUT', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
  };
}
