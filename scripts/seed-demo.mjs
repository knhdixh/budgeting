// Fills a local dev database with realistic demo data (for screenshots and trying things out).
// Usage: npm run dev, then: node scripts/seed-demo.mjs [http://localhost:8787]
const BASE = process.argv[2] ?? 'http://localhost:8787';
if (!/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) throw new Error('Demo data is for local development only.');

const login = await fetch(`${BASE}/auth/dev`, { redirect: 'manual' });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Dev login failed; is DEV_LOGIN=1 in .dev.vars?');
const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { cookie, origin: BASE, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error}`);
  return json;
};

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const day = (monthsAgo, d) => {
  const x = new Date(now.getFullYear(), now.getMonth() - monthsAgo, Math.min(d, 28));
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const month = (monthsAgo) => day(monthsAgo, 1).slice(0, 7);
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const start = day(3, 1);

await call('PUT', '/api/rates/manual', { currency: 'VND', rate: 29500 });
const checking = (await call('POST', '/api/accounts', { name: 'Nordea', type: 'checking', currency: 'EUR', startingBalance: 184000, startingDate: start })).id;
const savings = (await call('POST', '/api/accounts', { name: 'Savings', type: 'savings', currency: 'EUR', startingBalance: 650000, startingDate: start })).id;
const card = (await call('POST', '/api/accounts', { name: 'Visa', type: 'credit', currency: 'EUR', startingBalance: 0, startingDate: start })).id;
const usd = (await call('POST', '/api/accounts', { name: 'Revolut USD', type: 'checking', currency: 'USD', startingBalance: 54000, startingDate: start })).id;
await call('POST', '/api/accounts', { name: 'Index funds', type: 'investment', currency: 'EUR', onBudget: false, startingBalance: 1240000, startingDate: start });
await call('POST', '/api/accounts', { name: 'Cash', type: 'cash', currency: 'EUR', startingBalance: 6000, startingDate: start });

const tx = (accountId, date, amount, payee, categoryId, extra = {}) =>
  date <= today ? call('POST', '/api/transactions', { accountId, date, amount, payee, categoryId, cleared: 'cleared', ...extra }) : null;

for (let m = 3; m >= 0; m--) {
  await tx(checking, day(m, 1), 325000, 'Employer Oy', 'cat-inflow');
  await tx(checking, day(m, 2), -98000, 'Kojamo', 'cat-rent');
  await tx(checking, day(m, 4), -2990, 'Elisa', 'cat-phone');
  await tx(checking, day(m, 6), -6400, 'Helen', 'cat-utilities');
  await tx(card, day(m, 7), -1599, 'Spotify', 'cat-subscriptions');
  await tx(card, day(m, 9), -1299, 'Netflix', 'cat-subscriptions');
  await tx(checking, day(m, 10), -6560, 'HSL', 'cat-transport');
  for (const [d, amt, who] of [[3, -4380, 'K-Citymarket'], [8, -2645, 'Lidl'], [13, -5120, 'Prisma'], [18, -1890, 'Alepa'], [24, -3975, 'K-Citymarket']]) {
    await tx(card, day(m, d), amt - m * 37, who, 'cat-groceries');
  }
  await tx(card, day(m, 12), -2450, 'Ravintola Kuu', 'cat-eating-out');
  await tx(card, day(m, 20), -1380, 'Fazer Café', 'cat-eating-out', { tags: ['friends'] });
  await tx(card, day(m, 15), -5400, 'Finnkino', 'cat-entertainment');
  await tx(checking, day(m, 25), -40000, null, null, { transferAccountId: savings, payee: null });
  await tx(checking, day(m, 26), -45000, null, null, { transferAccountId: card, payee: null });
  for (const [cat, amount] of [['cat-rent', 98000], ['cat-utilities', 7000], ['cat-phone', 3000], ['cat-groceries', 45000], ['cat-transport', 7000],
    ['cat-eating-out', 8000], ['cat-subscriptions', 3000], ['cat-entertainment', 6000], ['cat-emergency', 20000], ['cat-travel', 15000], ['cat-household', 5000], ['cat-health', 3000], ['cat-insurance', 3500]]) {
    await call('PUT', `/api/budget/${month(m)}/${cat}`, { assigned: amount });
  }
  if (m === 3) await call('PUT', `/api/budget/${month(m)}/cat-emergency`, { assigned: 670000 });
}
await tx(card, day(0, 5), -8940, 'Tokmanni', null, { splits: [{ categoryId: 'cat-household', amount: -6200 }, { categoryId: 'cat-groceries', amount: -2740 }] });
await tx(usd, day(1, 14), -12900, 'Amazon', 'cat-shopping');
await tx(checking, day(0, 3), -2350, 'Unknown merchant', null, { cleared: 'uncleared' });
await call('PATCH', '/api/categories/cat-travel', { targetType: 'by_date', targetAmount: 120000, targetDate: month(-4) });
await call('PATCH', '/api/categories/cat-groceries', { targetType: 'monthly', targetAmount: 45000 });
await call('PATCH', '/api/categories/cat-emergency', { targetType: 'monthly', targetAmount: 25000 });
await call('POST', '/api/schedules', { accountId: checking, payee: 'Kojamo', categoryId: 'cat-rent', amount: -98000, frequency: 'monthly', startDate: day(-1, 2), autoPost: true });
await call('POST', '/api/schedules', { accountId: checking, payee: 'Employer Oy', categoryId: 'cat-inflow', amount: 325000, frequency: 'monthly', startDate: day(-1, 1), autoPost: true });
await call('POST', '/api/schedules', { accountId: card, payee: 'Spotify', categoryId: 'cat-subscriptions', amount: -1599, frequency: 'monthly', startDate: day(-1, 7), autoPost: true });
await call('POST', '/api/schedules', { accountId: checking, payee: 'If Vakuutus', categoryId: 'cat-insurance', amount: -42000, frequency: 'yearly', startDate: day(-2, 15) });
console.log('Demo data added.');
