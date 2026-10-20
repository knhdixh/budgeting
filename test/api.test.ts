import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../worker/index';
import { runDaily } from '../worker/index';
import { setup } from './helpers';

afterEach(() => vi.unstubAllGlobals());

async function account(t: Awaited<ReturnType<typeof setup>>, extra: Record<string, unknown> = {}) {
  const res = await t.post('/api/accounts', { name: 'Checking', type: 'checking', currency: 'EUR', startingBalance: 100000, startingDate: '2026-10-01', ...extra });
  expect(res.status).toBe(201);
  return res.json.id as string;
}

describe('access', () => {
  it('rejects requests without a session', async () => {
    const t = await setup();
    const res = await app.request('http://localhost/api/bootstrap', {}, t.env);
    expect(res.status).toBe(401);
  });

  it('rejects cross-origin writes', async () => {
    const t = await setup();
    const res = await app.request('http://localhost/api/accounts', {
      method: 'POST', headers: { cookie: t.cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}',
    }, t.env);
    expect(res.status).toBe(403);
  });

  it('hides the dev login unless enabled locally', async () => {
    const t = await setup({ DEV_LOGIN: undefined });
    expect((await app.request('http://localhost/auth/dev', {}, t.env)).status).toBe(404);
    const t2 = await setup();
    expect((await app.request('https://budgeting.knhdixh.com/auth/dev', {}, t2.env)).status).toBe(404);
  });

  it('drops sessions of emails removed from the allowlist', async () => {
    const t = await setup();
    t.env.ALLOWED_EMAILS = 'someone-else@example.com';
    expect((await t.get('/api/bootstrap')).status).toBe(401);
  });

  it('redirects workers.dev to the canonical host', async () => {
    const t = await setup();
    const res = await app.request('https://budgeting.x.workers.dev/budget?m=1', {}, t.env);
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://budgeting.knhdixh.com/budget?m=1');
  });

  it('sets security headers', async () => {
    const t = await setup();
    const res = await t.get('/api/me');
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('ledger', () => {
  it('creates accounts with a starting balance that funds the budget', async () => {
    const t = await setup();
    await account(t);
    const boot = (await t.get('/api/bootstrap')).json;
    expect(boot.accounts[0].balance).toBe(100000);
    const budget = (await t.get('/api/budget/2026-10')).json;
    expect(budget.readyToAssign).toBe(100000);
  });

  it('learns payee categories and searches transactions', async () => {
    const t = await setup();
    const acc = await account(t);
    await t.post('/api/transactions', { accountId: acc, date: '2026-10-02', amount: -2350, payee: 'Lidl', categoryId: 'cat-groceries' });
    const second = await t.post('/api/transactions', { accountId: acc, date: '2026-10-05', amount: -1200, payee: 'lidl', memo: 'milk' });
    const loaded = (await t.get(`/api/transactions/${second.json.id}`)).json;
    expect(loaded.categoryId).toBe('cat-groceries');
    expect(loaded.payee).toBe('Lidl');
    const found = (await t.get('/api/transactions?q=milk')).json;
    expect(found.items).toHaveLength(1);
    expect((await t.get('/api/transactions?q=23.50')).json.items).toHaveLength(1);
  });

  it('keeps running balances per account', async () => {
    const t = await setup();
    const acc = await account(t);
    await t.post('/api/transactions', { accountId: acc, date: '2026-10-02', amount: -1000, payee: 'A' });
    await t.post('/api/transactions', { accountId: acc, date: '2026-10-03', amount: -500, payee: 'B' });
    const items = (await t.get(`/api/transactions?account=${acc}`)).json.items;
    expect(items.map((i: any) => i.running)).toEqual([98500, 99000, 100000]);
  });

  it('links both sides of a transfer and keeps the budget unchanged', async () => {
    const t = await setup();
    const a = await account(t);
    const b = await account(t, { name: 'Savings', type: 'savings', startingBalance: 0 });
    const res = await t.post('/api/transactions', { accountId: a, transferAccountId: b, date: '2026-10-03', amount: -20000 });
    const boot = (await t.get('/api/bootstrap')).json;
    expect(boot.accounts.find((x: any) => x.id === a).balance).toBe(80000);
    expect(boot.accounts.find((x: any) => x.id === b).balance).toBe(20000);
    expect((await t.get('/api/budget/2026-10')).json.readyToAssign).toBe(100000);
    await t.del(`/api/transactions/${res.json.id}`);
    expect((await t.get('/api/bootstrap')).json.accounts.find((x: any) => x.id === b).balance).toBe(0);
  });

  it('turns money moved to a tracking account into spending from ready to assign', async () => {
    const t = await setup();
    const a = await account(t);
    const inv = await account(t, { name: 'Broker', type: 'investment', onBudget: false, startingBalance: 0 });
    await t.post('/api/transactions', { accountId: a, transferAccountId: inv, date: '2026-10-03', amount: -30000 });
    expect((await t.get('/api/budget/2026-10')).json.readyToAssign).toBe(70000);
  });

  it('validates and stores splits', async () => {
    const t = await setup();
    const acc = await account(t);
    const bad = await t.post('/api/transactions', { accountId: acc, date: '2026-10-04', amount: -5000, payee: 'Prisma', splits: [{ categoryId: 'cat-groceries', amount: -3000 }, { categoryId: 'cat-household', amount: -1000 }] });
    expect(bad.status).toBe(400);
    await t.post('/api/transactions', { accountId: acc, date: '2026-10-04', amount: -5000, payee: 'Prisma', splits: [{ categoryId: 'cat-groceries', amount: -3000 }, { categoryId: 'cat-household', amount: -2000 }] });
    const b = (await t.get('/api/budget/2026-10')).json;
    expect(b.categories['cat-groceries'].activity).toBe(-3000);
    expect(b.categories['cat-household'].activity).toBe(-2000);
    const items = (await t.get('/api/transactions?category=cat-household')).json.items;
    expect(items).toHaveLength(1);
    expect(items[0].splits).toHaveLength(2);
  });

  it('edits a transaction in place, including tags', async () => {
    const t = await setup();
    const acc = await account(t);
    const { json } = await t.post('/api/transactions', { accountId: acc, date: '2026-10-04', amount: -5000, payee: 'Shop', tags: ['Trip', 'trip', 'work'] });
    await t.patch(`/api/transactions/${json.id}`, { amount: -6000, cleared: 'cleared' });
    const loaded = (await t.get(`/api/transactions/${json.id}`)).json;
    expect(loaded.amount).toBe(-6000);
    expect(loaded.cleared).toBe('cleared');
    expect(loaded.tags.sort()).toEqual(['trip', 'work']);
  });

  it('reconciles with an adjustment', async () => {
    const t = await setup();
    const acc = await account(t);
    await t.post('/api/transactions', { accountId: acc, date: '2026-10-04', amount: -1000, payee: 'X', cleared: 'cleared' });
    const res = await t.post(`/api/accounts/${acc}/reconcile`, { balance: 98500, date: '2026-10-10' });
    expect(res.json.adjustment).toBe(-500);
    const items = (await t.get(`/api/transactions?account=${acc}`)).json.items;
    expect(items.every((i: any) => i.cleared === 'reconciled')).toBe(true);
  });

  it('imports CSV rows once, even when the file is imported again', async () => {
    const t = await setup();
    const acc = await account(t);
    const rows = [
      { date: '2026-10-06', amount: -450, payee: 'Coffee' },
      { date: '2026-10-06', amount: -450, payee: 'Coffee' },
      { date: '2026-10-07', amount: 250000, payee: 'Employer', category: 'ready to assign' },
    ];
    expect((await t.post('/api/import', { accountId: acc, rows })).json).toEqual({ imported: 3, skipped: 0 });
    expect((await t.post('/api/import', { accountId: acc, rows })).json).toEqual({ imported: 0, skipped: 3 });
    expect((await t.get('/api/budget/2026-10')).json.readyToAssign).toBe(100000 + 250000 - 900);
  });
});

describe('budget', () => {
  it('assigns, moves and auto-assigns money', async () => {
    const t = await setup();
    await account(t);
    await t.put('/api/budget/2026-10/cat-rent', { assigned: 60000 });
    await t.post('/api/budget/2026-10/move', { from: 'cat-rent', to: 'cat-groceries', amount: 10000 });
    let b = (await t.get('/api/budget/2026-10')).json;
    expect(b.categories['cat-rent'].assigned).toBe(50000);
    expect(b.categories['cat-groceries'].assigned).toBe(10000);
    expect(b.readyToAssign).toBe(40000);

    await t.patch('/api/categories/cat-phone', { targetType: 'monthly', targetAmount: 2500 });
    await t.post('/api/budget/2026-10/auto', { mode: 'targets' });
    b = (await t.get('/api/budget/2026-10')).json;
    expect(b.categories['cat-phone'].assigned).toBe(2500);
    expect(b.categories['cat-phone'].underfunded).toBe(0);

    await t.post('/api/budget/2026-11/auto', { mode: 'last_month' });
    expect((await t.get('/api/budget/2026-11')).json.categories['cat-rent'].assigned).toBe(50000);
  });

  it('moves money and transactions when a category is deleted', async () => {
    const t = await setup();
    const acc = await account(t);
    await t.put('/api/budget/2026-10/cat-shopping', { assigned: 5000 });
    await t.post('/api/transactions', { accountId: acc, date: '2026-10-04', amount: -1000, payee: 'Shop', categoryId: 'cat-shopping' });
    await t.del('/api/categories/cat-shopping?into=cat-household');
    const b = (await t.get('/api/budget/2026-10')).json;
    expect(b.categories['cat-household'].available).toBe(4000);
  });
});

describe('currencies', () => {
  it('converts foreign accounts to the base currency with ECB rates', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const range = /\/v1\/([\d-]+)\.\.([\d-]+)/.exec(url);
      const rates: Record<string, Record<string, number>> = {};
      if (range) {
        for (let d = new Date(range[1]); d <= new Date(range[2]); d.setUTCDate(d.getUTCDate() + 1)) rates[d.toISOString().slice(0, 10)] = { USD: 1.25 };
        return Response.json({ base: 'EUR', rates });
      }
      return Response.json({ base: 'EUR', date: url.split('/v1/')[1].slice(0, 10), rates: { USD: 1.25 } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const t = await setup();
    const usd = await account(t, { name: 'US bank', currency: 'USD', startingBalance: 12500, startingDate: '2026-10-01' });
    const boot = (await t.get('/api/bootstrap')).json;
    expect(boot.accounts.find((a: any) => a.id === usd).balanceBase).toBe(10000);
    expect((await t.get('/api/budget/2026-10')).json.readyToAssign).toBe(10000);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('needs a manual rate for currencies the ECB does not publish', async () => {
    const t = await setup();
    const bad = await t.post('/api/accounts', { name: 'VN', type: 'checking', currency: 'VND', startingBalance: 0, startingDate: '2026-10-01' });
    expect(bad.status).toBe(400);
    await t.put('/api/rates/manual', { currency: 'VND', rate: 30000 });
    const ok = await t.post('/api/accounts', { name: 'VN', type: 'cash', currency: 'VND', startingBalance: 300000000, startingDate: '2026-10-01' });
    expect(ok.status).toBe(201);
    expect((await t.get('/api/budget/2026-10')).json.readyToAssign).toBe(10000);
  });
});

describe('schedules', () => {
  it('posts due auto-post schedules in the daily job and moves them forward', async () => {
    const t = await setup();
    const acc = await account(t);
    const s = await t.post('/api/schedules', { accountId: acc, payee: 'Landlord', categoryId: 'cat-rent', amount: -90000, frequency: 'monthly', startDate: '2026-01-01', autoPost: true });
    expect(s.status).toBe(201);
    // Starting in the past only schedules the next future date; nothing old is back-filled.
    expect(s.json.nextDate > '2026-01-01').toBe(true);
    await t.call('POST', `/api/schedules/${s.json.id}/post`, {});
    const items = (await t.get('/api/transactions?payee=' + (await t.get('/api/bootstrap')).json.payees.find((p: any) => p.name === 'Landlord').id)).json.items;
    expect(items).toHaveLength(1);
    const list = (await t.get('/api/schedules')).json;
    expect(list[0].nextDate > s.json.nextDate).toBe(true);
    await runDaily(t.env); // nothing due yet
    expect((await t.get('/api/transactions?q=Landlord')).json.items).toHaveLength(1);
  });
});

describe('export', () => {
  it('exports JSON and CSV', async () => {
    const t = await setup();
    const acc = await account(t);
    await t.post('/api/transactions', { accountId: acc, date: '2026-10-04', amount: -1234, payee: 'Café "Kulma", Helsinki' });
    const json = (await t.get('/api/export.json')).json;
    expect(json.transactions).toHaveLength(2);
    expect(json.users).toBeUndefined();
    const csv = (await t.get('/api/export.csv')).json as string;
    expect(csv).toContain('"Café ""Kulma"", Helsinki"');
    expect(csv.split('\n')[0]).toBe('date,account,payee,category,memo,amount,currency,amount_base,cleared,tags');
  });
});

describe('reports', () => {
  it('summarises spending, cash flow and net worth', async () => {
    const t = await setup();
    const acc = await account(t, { startingDate: '2026-01-01' });
    await t.post('/api/transactions', { accountId: acc, date: new Date().toISOString().slice(0, 10), amount: -4000, payee: 'Lidl', categoryId: 'cat-groceries' });
    const today = new Date().toISOString().slice(0, 10);
    const spending = (await t.get(`/api/reports/spending?from=2026-01-01&to=${today}`)).json;
    expect(spending.categories[0]).toEqual({ categoryId: 'cat-groceries', total: -4000 });
    const flow = (await t.get('/api/reports/cashflow?months=12')).json;
    expect(flow.at(-1).expense).toBe(4000);
    const nw = (await t.get('/api/reports/networth?months=3')).json;
    expect(nw.at(-1).net).toBe(96000);
  });
});

describe('cash flow', () => {
  it('leaves starting balances out of income', async () => {
    const t = await setup();
    await account(t, { startingDate: new Date().toISOString().slice(0, 10) });
    const flow = (await t.get('/api/reports/cashflow?months=1')).json;
    expect(flow[0].income).toBe(0);
  });
});
