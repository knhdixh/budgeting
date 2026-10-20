import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import { computeBudget, type BudgetInput } from '../shared/budget';
import { addDays, addMonths, lastDayOfMonth, monthOf, nextOccurrence, todayIn } from '../shared/dates';
import { ECB_CURRENCIES } from '../shared/money';
import * as S from '../shared/schemas';
import { requireUser } from './auth';
import {
  accounts, budgets, categories, categoryGroups, fxRates, payees, schedules, settings, splits, tags, transactions,
} from './db/schema';
import type { AppEnv, DB } from './env';
import { MANUAL, baseCurrency, latestRates, rateBook } from './fx';
import { HttpError, deleteTransactions, inflowCategoryId, loadInput, payeeId, where, writeTransaction } from './ledger';

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  const json = await c.req.json().catch(() => undefined);
  const result = schema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, `${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return result.data;
}

export async function getSetting(db: DB, key: string, fallback: string) {
  return (await db.select().from(settings).where(eq(settings.key, key)).get())?.value ?? fallback;
}

async function setSetting(db: DB, key: string, value: string) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

export const today = async (db: DB) => todayIn(await getSetting(db, 'time_zone', 'Europe/Helsinki'));

async function accountBalances(db: DB) {
  const rows = await db.select({
    accountId: transactions.accountId,
    balance: sql<number>`sum(${transactions.amount})`,
    cleared: sql<number>`sum(case when ${transactions.cleared} != 'uncleared' then ${transactions.amount} else 0 end)`,
    count: sql<number>`count(*)`,
  }).from(transactions).groupBy(transactions.accountId).all();
  return new Map(rows.map((r) => [r.accountId, r]));
}

/** Everything the app shell needs in one round trip. */
async function bootstrap(db: DB) {
  const [base, timeZone, accs, balances, groups, cats, payeeRows, tagRows, uncategorized] = await Promise.all([
    baseCurrency(db),
    getSetting(db, 'time_zone', 'Europe/Helsinki'),
    db.select().from(accounts).orderBy(asc(accounts.closed), asc(accounts.sort), asc(accounts.createdAt)).all(),
    accountBalances(db),
    db.select().from(categoryGroups).orderBy(asc(categoryGroups.sort), asc(categoryGroups.name)).all(),
    db.select().from(categories).orderBy(asc(categories.sort), asc(categories.name)).all(),
    db.select({ id: payees.id, name: payees.name, defaultCategoryId: payees.defaultCategoryId, count: sql<number>`(select count(*) from transactions t where t.payee_id = ${payees.id})` })
      .from(payees).orderBy(asc(payees.name)).all(),
    db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name)).all(),
    db.select({ n: sql<number>`count(*)` }).from(transactions).innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(and(eq(accounts.onBudget, true), sql`${transactions.categoryId} is null`, eq(transactions.isSplit, false), sql`${transactions.transferId} is null`)).get(),
  ]);
  const currencies = [...new Set([base, ...accs.map((a) => a.currency)])];
  const rates = await latestRates(db, currencies);
  const toBase = (cents: number, cur: string) => (rates[cur] && rates[base] ? Math.round((cents * rates[base]) / rates[cur]) : null);
  return {
    settings: { baseCurrency: base, timeZone },
    accounts: accs.map((a) => {
      const b = balances.get(a.id);
      const balance = b?.balance ?? 0;
      return { ...a, balance, cleared: b?.cleared ?? 0, transactionCount: b?.count ?? 0, balanceBase: toBase(balance, a.currency) };
    }),
    groups: groups.map((g) => ({ ...g, categories: cats.filter((c) => c.groupId === g.id) })),
    payees: payeeRows,
    tags: tagRows,
    rates,
    uncategorized: uncategorized?.n ?? 0,
  };
}

/** Month → category → base-currency activity on on-budget accounts ('' = uncategorized). */
async function budgetActivity(db: DB, untilMonth: string) {
  const until = lastDayOfMonth(untilMonth);
  const rows = await db.all<{ m: string; c: string | null; v: number }>(sql`
    SELECT substr(t.date, 1, 7) AS m, t.category_id AS c, sum(t.amount_base) AS v
      FROM transactions t JOIN accounts a ON a.id = t.account_id
     WHERE a.on_budget = 1 AND t.is_split = 0 AND t.date <= ${until}
     GROUP BY m, c
    UNION ALL
    SELECT substr(t.date, 1, 7) AS m, s.category_id AS c, sum(s.amount_base) AS v
      FROM splits s JOIN transactions t ON t.id = s.transaction_id JOIN accounts a ON a.id = t.account_id
     WHERE a.on_budget = 1 AND t.date <= ${until}
     GROUP BY m, c`);
  const activity: BudgetInput['activity'] = {};
  for (const r of rows) {
    const month = (activity[r.m] ??= {});
    month[r.c ?? ''] = (month[r.c ?? ''] ?? 0) + r.v;
  }
  return activity;
}

async function budgetInput(db: DB, month: string): Promise<BudgetInput> {
  const [cats, assignedRows, activity] = await Promise.all([
    db.select({ id: categories.id, isIncome: categoryGroups.isIncome, targetType: categories.targetType, targetAmount: categories.targetAmount, targetDate: categories.targetDate })
      .from(categories).innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId)).all(),
    db.select().from(budgets).where(sql`${budgets.month} <= ${month}`).all(),
    budgetActivity(db, month),
  ]);
  const assigned: BudgetInput['assigned'] = {};
  for (const r of assignedRows) (assigned[r.month] ??= {})[r.categoryId] = r.assigned;
  return { categories: cats, assigned, activity };
}

async function setAssigned(db: DB, month: string, categoryId: string, amount: number) {
  await db.insert(budgets).values({ month, categoryId, assigned: amount })
    .onConflictDoUpdate({ target: [budgets.month, budgets.categoryId], set: { assigned: amount } });
}

function toInput(t: z.output<typeof S.scheduleInput>, date: string): z.output<typeof S.transactionInput> {
  return {
    accountId: t.accountId, date, amount: t.amount, payee: t.payee, categoryId: t.categoryId, memo: t.memo,
    cleared: 'uncleared', tags: [], splits: [], transferAccountId: t.transferAccountId,
  };
}

/** Posts every due occurrence of a schedule up to `until` and moves it forward. */
export async function postSchedule(db: DB, id: string, until: string, opts: { once?: boolean } = {}) {
  const s = await db.select().from(schedules).where(eq(schedules.id, id)).get();
  if (!s) throw new HttpError(404, 'Schedule not found');
  const payee = s.payeeId ? await db.select().from(payees).where(eq(payees.id, s.payeeId)).get() : null;
  let next = s.nextDate;
  let posted = 0;
  while ((opts.once ? posted === 0 : next <= until) && (!s.endDate || next <= s.endDate) && posted < 60) {
    const txId = await writeTransaction(db, toInput({ ...s, payee: payee?.name ?? null, interval: s.interval, autoPost: s.autoPost }, next));
    await db.update(transactions).set({ scheduleId: s.id }).where(eq(transactions.id, txId));
    next = nextOccurrence(s.startDate, s.frequency, s.interval, next);
    posted++;
  }
  if (s.endDate && next > s.endDate) await db.delete(schedules).where(eq(schedules.id, id));
  else await db.update(schedules).set({ nextDate: next }).where(eq(schedules.id, id));
  return posted;
}

export const api = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true }))
  .use('*', requireUser)
  .get('/me', (c) => c.json(c.var.user))
  .get('/bootstrap', async (c) => c.json(await bootstrap(c.var.db)))

  // ---------- settings ----------
  .patch('/settings', async (c) => {
    const db = c.var.db;
    const input = await body(c, S.settingsInput);
    if (input.baseCurrency && input.baseCurrency !== (await baseCurrency(db))) {
      const n = await db.select({ n: sql<number>`count(*)` }).from(transactions).get();
      if (n && n.n > 0) throw new HttpError(409, 'The base currency can only change before the first transaction.');
      await setSetting(db, 'base_currency', input.baseCurrency);
    }
    if (input.timeZone) {
      try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); } catch { throw new HttpError(400, 'Unknown time zone'); }
      await setSetting(db, 'time_zone', input.timeZone);
    }
    return c.json({ ok: true });
  })
  .put('/rates/manual', async (c) => {
    const { currency, rate } = await body(c, S.manualRateInput);
    if (ECB_CURRENCIES.includes(currency)) throw new HttpError(400, `${currency} uses daily ECB rates`);
    const db = c.var.db;
    if (rate === null) await db.delete(fxRates).where(and(eq(fxRates.currency, currency), eq(fxRates.date, MANUAL)));
    else await db.insert(fxRates).values({ date: MANUAL, currency, rate }).onConflictDoUpdate({ target: [fxRates.currency, fxRates.date], set: { rate } });
    return c.json({ ok: true });
  })

  // ---------- accounts ----------
  .post('/accounts', async (c) => {
    const db = c.var.db;
    const input = await body(c, S.accountCreate);
    const sort = (await db.select({ m: sql<number>`coalesce(max(sort), 0)` }).from(accounts).get())?.m ?? 0;
    if (!ECB_CURRENCIES.includes(input.currency)) {
      const manual = await db.select().from(fxRates).where(and(eq(fxRates.currency, input.currency), eq(fxRates.date, MANUAL))).get();
      if (!manual) throw new HttpError(400, `Set an exchange rate for ${input.currency} in settings first.`);
    }
    const [acc] = await db.insert(accounts).values({
      name: input.name, type: input.type, currency: input.currency, onBudget: input.onBudget, note: input.note ?? null, sort: sort + 1,
    }).returning();
    if (input.startingBalance !== 0) {
      await writeTransaction(db, {
        accountId: acc.id, date: input.startingDate, amount: input.startingBalance, payee: 'Starting balance',
        categoryId: input.onBudget ? await inflowCategoryId(db) : null, cleared: 'reconciled', tags: [], splits: [],
      });
    }
    return c.json(acc, 201);
  })
  .patch('/accounts/:id', async (c) => {
    const input = await body(c, S.accountUpdate);
    const [row] = await c.var.db.update(accounts).set(input).where(eq(accounts.id, c.req.param('id'))).returning();
    if (!row) throw new HttpError(404, 'Account not found');
    return c.json(row);
  })
  .delete('/accounts/:id', async (c) => {
    const db = c.var.db;
    const id = c.req.param('id');
    // Remove transfer counterparts in other accounts first, then the account (cascades the rest).
    await db.run(sql`DELETE FROM transactions WHERE id IN (SELECT transfer_id FROM transactions WHERE account_id = ${id} AND transfer_id IS NOT NULL)`);
    await db.delete(accounts).where(eq(accounts.id, id));
    return c.json({ ok: true });
  })
  .post('/accounts/:id/reconcile', async (c) => {
    const db = c.var.db;
    const id = c.req.param('id');
    const { balance, date } = await body(c, S.reconcileInput);
    const acc = await db.select().from(accounts).where(eq(accounts.id, id)).get();
    if (!acc) throw new HttpError(404, 'Account not found');
    const cleared = (await accountBalances(db)).get(id)?.cleared ?? 0;
    const diff = balance - cleared;
    if (diff !== 0) {
      await writeTransaction(db, {
        accountId: id, date, amount: diff, payee: 'Reconciliation adjustment',
        categoryId: acc.onBudget ? await inflowCategoryId(db) : null, cleared: 'cleared', tags: [], splits: [],
      });
    }
    await db.update(transactions).set({ cleared: 'reconciled' }).where(and(eq(transactions.accountId, id), eq(transactions.cleared, 'cleared')));
    return c.json({ adjustment: diff });
  })

  // ---------- transactions ----------
  .get('/transactions', async (c) => {
    const db = c.var.db;
    const q = c.req.query();
    const limit = Math.min(Number(q.limit) || 100, 500);
    const offset = Number(q.offset) || 0;
    const search = q.q?.trim();
    const amountSearch = search && /^-?[\d.,]+$/.test(search) ? Math.round(Math.abs(Number(search.replace(',', '.'))) * 100) : null;
    const filter = where(
      q.account ? sql`t.account_id = ${q.account}` : undefined,
      q.category === 'uncategorized'
        ? sql`t.category_id is null and t.is_split = 0 and t.transfer_id is null`
        : q.category ? sql`(t.category_id = ${q.category} or exists (select 1 from splits s where s.transaction_id = t.id and s.category_id = ${q.category}))` : undefined,
      q.payee ? sql`t.payee_id = ${q.payee}` : undefined,
      q.tag ? sql`exists (select 1 from transaction_tags tt where tt.transaction_id = t.id and tt.tag_id = ${q.tag})` : undefined,
      q.from ? sql`t.date >= ${q.from}` : undefined,
      q.to ? sql`t.date <= ${q.to}` : undefined,
      q.cleared === 'uncleared' ? sql`t.cleared = 'uncleared'` : undefined,
      search ? or(
        sql`p.name LIKE ${`%${search}%`}`, sql`t.memo LIKE ${`%${search}%`}`, sql`categories.name LIKE ${`%${search}%`}`,
        amountSearch !== null ? sql`abs(t.amount) = ${amountSearch}` : undefined,
      ) : undefined,
    );
    // Running balance is computed over the whole account before filtering, so it stays correct.
    const rows = await db.all<Record<string, unknown>>(sql`
      WITH ranked AS (
        SELECT id, sum(amount) OVER (PARTITION BY account_id ORDER BY date, created_at, id ROWS UNBOUNDED PRECEDING) AS running
          FROM transactions ${q.account ? sql`WHERE account_id = ${q.account}` : sql``}
      )
      SELECT t.id, t.account_id AS accountId, t.date, t.amount, t.amount_base AS amountBase, t.payee_id AS payeeId,
             p.name AS payee, t.category_id AS categoryId, t.is_split AS isSplit, t.transfer_id AS transferId,
             o.account_id AS transferAccountId, t.memo, t.cleared, t.schedule_id AS scheduleId, r.running,
             (SELECT group_concat(g.name, ',') FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags
        FROM transactions t
        JOIN ranked r ON r.id = t.id
        LEFT JOIN payees p ON p.id = t.payee_id
        LEFT JOIN categories ON categories.id = t.category_id
        LEFT JOIN transactions o ON o.id = t.transfer_id
       ${filter ? sql`WHERE ${filter}` : sql``}
       ORDER BY t.date DESC, t.created_at DESC, t.id DESC
       LIMIT ${limit + 1} OFFSET ${offset}`);
    const page = rows.slice(0, limit);
    const splitIds = page.filter((r) => r.isSplit).map((r) => r.id as string);
    const splitRows = splitIds.length ? await db.select().from(splits).where(inArray(splits.transactionId, splitIds)).all() : [];
    return c.json({
      items: page.map((r) => ({
        ...r,
        isSplit: !!r.isSplit,
        tags: r.tags ? String(r.tags).split(',') : [],
        splits: r.isSplit ? splitRows.filter((s) => s.transactionId === r.id) : [],
      })),
      hasMore: rows.length > limit,
    });
  })
  .get('/transactions/:id', async (c) => c.json(await loadInput(c.var.db, c.req.param('id'))))
  .post('/transactions', async (c) => {
    const input = await body(c, S.transactionInput);
    return c.json({ id: await writeTransaction(c.var.db, input) }, 201);
  })
  .put('/transactions/:id', async (c) => {
    const input = await body(c, S.transactionInput);
    return c.json({ id: await writeTransaction(c.var.db, input, c.req.param('id')) });
  })
  .patch('/transactions/:id', async (c) => {
    const db = c.var.db;
    const patch = await body(c, S.transactionPatch);
    const current = await loadInput(db, c.req.param('id'));
    const merged = S.transactionInput.parse({ ...current, ...patch });
    return c.json({ id: await writeTransaction(db, merged, c.req.param('id')) });
  })
  .delete('/transactions/:id', async (c) => {
    await deleteTransactions(c.var.db, [c.req.param('id')]);
    return c.json({ ok: true });
  })
  .post('/transactions/bulk', async (c) => {
    const db = c.var.db;
    const { ids, action, categoryId } = await body(c, S.bulkAction);
    if (action === 'delete') await deleteTransactions(db, ids);
    else if (action === 'clear' || action === 'unclear') {
      await db.update(transactions).set({ cleared: action === 'clear' ? 'cleared' : 'uncleared', updatedAt: Date.now() })
        .where(and(inArray(transactions.id, ids), ne(transactions.cleared, 'reconciled')));
    } else {
      // Splits and on-budget transfers keep their own categorisation.
      await db.update(transactions).set({ categoryId: categoryId ?? null, updatedAt: Date.now() })
        .where(and(inArray(transactions.id, ids), eq(transactions.isSplit, false), sql`transfer_id is null`));
    }
    return c.json({ ok: true, count: ids.length });
  })
  .post('/import', async (c) => {
    const db = c.var.db;
    const { accountId, rows } = await body(c, S.importInput);
    const acc = await db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!acc) throw new HttpError(404, 'Account not found');
    const base = await baseCurrency(db);
    const dates = rows.map((r) => r.date).sort();
    const book = await rateBook(db, [acc.currency, base], dates[0], dates[dates.length - 1]);

    const names = [...new Set(rows.map((r) => r.payee?.trim()).filter((x): x is string => !!x))];
    for (let i = 0; i < names.length; i += 500) {
      await db.run(sql`INSERT INTO payees (id, name) SELECT lower(hex(randomblob(16))), value FROM json_each(${JSON.stringify(names.slice(i, i + 500))}) WHERE true
        ON CONFLICT(name) DO NOTHING`);
    }
    const payeeRows = await db.select().from(payees).all();
    const payeeMap = new Map(payeeRows.map((p) => [p.name.toLowerCase(), p]));
    const catRows = await db.select({ id: categories.id, name: categories.name }).from(categories).all();
    const catMap = new Map(catRows.map((x) => [x.name.toLowerCase(), x.id]));

    // A stable id per row lets the same file be imported twice without duplicates.
    const seen = new Map<string, number>();
    const prepared = rows.map((r) => {
      const key = `${r.date}|${r.amount}|${(r.payee ?? '').toLowerCase()}|${(r.memo ?? '').toLowerCase()}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const payee = r.payee ? payeeMap.get(r.payee.trim().toLowerCase()) : undefined;
      return {
        id: crypto.randomUUID(),
        account_id: accountId,
        date: r.date,
        amount: r.amount,
        amount_base: book.convert(r.amount, acc.currency, base, r.date),
        payee_id: payee?.id ?? null,
        category_id: (r.category ? catMap.get(r.category.toLowerCase()) : undefined) ?? payee?.defaultCategoryId ?? null,
        memo: r.memo ?? null,
        import_id: `${key}|${n}`,
        now: Date.now(),
      };
    });
    let imported = 0;
    for (let i = 0; i < prepared.length; i += 200) {
      const res = await db.run(sql`INSERT OR IGNORE INTO transactions
        (id, account_id, date, amount, amount_base, payee_id, category_id, is_split, memo, cleared, import_id, created_at, updated_at)
        SELECT value->>'id', value->>'account_id', value->>'date', value->>'amount', value->>'amount_base', value->>'payee_id',
               value->>'category_id', 0, value->>'memo', 'cleared', value->>'import_id', value->>'now', value->>'now'
          FROM json_each(${JSON.stringify(prepared.slice(i, i + 200))})`);
      imported += res.meta.changes ?? 0;
    }
    return c.json({ imported, skipped: rows.length - imported });
  })

  // ---------- categories ----------
  .post('/groups', async (c) => {
    const input = await body(c, S.groupInput);
    const sort = (await c.var.db.select({ m: sql<number>`coalesce(max(sort), 0)` }).from(categoryGroups).get())?.m ?? 0;
    const [row] = await c.var.db.insert(categoryGroups).values({ name: input.name, isIncome: input.isIncome ?? false, sort: input.sort ?? sort + 1 }).returning();
    return c.json(row, 201);
  })
  .patch('/groups/:id', async (c) => {
    const input = await body(c, S.groupInput.partial());
    const [row] = await c.var.db.update(categoryGroups).set(input).where(eq(categoryGroups.id, c.req.param('id'))).returning();
    if (!row) throw new HttpError(404, 'Group not found');
    return c.json(row);
  })
  .delete('/groups/:id', async (c) => {
    const db = c.var.db;
    const n = await db.select({ n: sql<number>`count(*)` }).from(categories).where(eq(categories.groupId, c.req.param('id'))).get();
    if (n && n.n > 0) throw new HttpError(409, 'Move or delete its categories first.');
    await db.delete(categoryGroups).where(eq(categoryGroups.id, c.req.param('id')));
    return c.json({ ok: true });
  })
  .post('/categories', async (c) => {
    const input = await body(c, S.categoryInput);
    const sort = (await c.var.db.select({ m: sql<number>`coalesce(max(sort), 0)` }).from(categories).where(eq(categories.groupId, input.groupId)).get())?.m ?? 0;
    const [row] = await c.var.db.insert(categories).values({ ...input, sort: input.sort ?? sort + 1 }).returning();
    return c.json(row, 201);
  })
  .patch('/categories/:id', async (c) => {
    const input = await body(c, S.categoryUpdate);
    const [row] = await c.var.db.update(categories).set(input).where(eq(categories.id, c.req.param('id'))).returning();
    if (!row) throw new HttpError(404, 'Category not found');
    return c.json(row);
  })
  .delete('/categories/:id', async (c) => {
    const db = c.var.db;
    const id = c.req.param('id');
    const into = c.req.query('into') || null;
    // Hand its transactions and budgeted money to another category (or leave them uncategorized).
    if (into) {
      await db.update(transactions).set({ categoryId: into }).where(eq(transactions.categoryId, id));
      await db.update(splits).set({ categoryId: into }).where(eq(splits.categoryId, id));
      await db.run(sql`INSERT INTO budgets (month, category_id, assigned)
        SELECT month, ${into}, assigned FROM budgets WHERE category_id = ${id}
        ON CONFLICT(month, category_id) DO UPDATE SET assigned = budgets.assigned + excluded.assigned`);
    }
    await db.delete(categories).where(eq(categories.id, id));
    return c.json({ ok: true });
  })

  // ---------- payees ----------
  .patch('/payees/:id', async (c) => {
    const input = await body(c, S.payeeUpdate);
    const [row] = await c.var.db.update(payees).set(input).where(eq(payees.id, c.req.param('id'))).returning();
    if (!row) throw new HttpError(404, 'Payee not found');
    return c.json(row);
  })
  .post('/payees/merge', async (c) => {
    const db = c.var.db;
    const { ids, into } = await body(c, S.payeeMerge);
    const others = ids.filter((x) => x !== into);
    if (others.length) {
      await db.update(transactions).set({ payeeId: into }).where(inArray(transactions.payeeId, others));
      await db.update(schedules).set({ payeeId: into }).where(inArray(schedules.payeeId, others));
      await db.delete(payees).where(inArray(payees.id, others));
    }
    return c.json({ ok: true });
  })
  .delete('/payees/:id', async (c) => {
    await c.var.db.delete(payees).where(eq(payees.id, c.req.param('id')));
    return c.json({ ok: true });
  })

  // ---------- budget ----------
  .get('/budget/:month', async (c) => {
    const month = S.isoMonth.parse(c.req.param('month'));
    const summary = computeBudget(await budgetInput(c.var.db, month), month);
    return c.json(summary);
  })
  .put('/budget/:month/:categoryId', async (c) => {
    const month = S.isoMonth.parse(c.req.param('month'));
    const { assigned } = await body(c, S.assignInput);
    await setAssigned(c.var.db, month, c.req.param('categoryId'), assigned);
    return c.json({ ok: true });
  })
  .post('/budget/:month/move', async (c) => {
    // Moves available money between categories; null means "ready to assign".
    const db = c.var.db;
    const month = S.isoMonth.parse(c.req.param('month'));
    const { from, to, amount } = await body(c, S.moveInput);
    const rows = await db.select().from(budgets).where(eq(budgets.month, month)).all();
    const current = (id: string) => rows.find((r) => r.categoryId === id)?.assigned ?? 0;
    if (from) await setAssigned(db, month, from, current(from) - amount);
    if (to) await setAssigned(db, month, to, current(to) + amount);
    return c.json({ ok: true });
  })
  .post('/budget/:month/auto', async (c) => {
    const db = c.var.db;
    const month = S.isoMonth.parse(c.req.param('month'));
    const { mode, categoryIds } = await body(c, S.autoAssignInput);
    const input = await budgetInput(db, month);
    const now = computeBudget(input, month);
    const only = categoryIds ? new Set(categoryIds) : null;
    let total = 0;
    for (const cat of input.categories.filter((x) => !x.isIncome && (!only || only.has(x.id)))) {
      const cur = now.categories[cat.id];
      let amount = cur.assigned;
      if (mode === 'targets') amount = cur.assigned + cur.underfunded;
      else if (mode === 'last_month') amount = input.assigned[addMonths(month, -1)]?.[cat.id] ?? 0;
      else {
        // Average spending over the last three months.
        let spent = 0;
        for (let i = 1; i <= 3; i++) spent += -(input.activity[addMonths(month, -i)]?.[cat.id] ?? 0);
        amount = Math.max(Math.round(spent / 3), 0);
      }
      if (amount !== cur.assigned) { await setAssigned(db, month, cat.id, amount); total += amount - cur.assigned; }
    }
    return c.json({ ok: true, total });
  })

  // ---------- schedules ----------
  .get('/schedules', async (c) => {
    const rows = await c.var.db.select({
      id: schedules.id, accountId: schedules.accountId, transferAccountId: schedules.transferAccountId, payeeId: schedules.payeeId,
      payee: payees.name, categoryId: schedules.categoryId, amount: schedules.amount, memo: schedules.memo, frequency: schedules.frequency,
      interval: schedules.interval, startDate: schedules.startDate, nextDate: schedules.nextDate, endDate: schedules.endDate, autoPost: schedules.autoPost,
    }).from(schedules).leftJoin(payees, eq(payees.id, schedules.payeeId)).orderBy(asc(schedules.nextDate)).all();
    return c.json(rows);
  })
  .post('/schedules', async (c) => {
    const db = c.var.db;
    const input = await body(c, S.scheduleInput);
    const payee = input.transferAccountId ? null : await payeeId(db, input.payee);
    const t = await today(db);
    const next = input.startDate >= t ? input.startDate : nextOccurrence(input.startDate, input.frequency, input.interval, addDays(t, -1));
    const [row] = await db.insert(schedules).values({
      accountId: input.accountId, transferAccountId: input.transferAccountId ?? null, payeeId: payee?.id ?? null, categoryId: input.categoryId ?? null,
      amount: input.amount, memo: input.memo ?? null, frequency: input.frequency, interval: input.interval, startDate: input.startDate,
      nextDate: next, endDate: input.endDate ?? null, autoPost: input.autoPost,
    }).returning();
    return c.json(row, 201);
  })
  .put('/schedules/:id', async (c) => {
    const db = c.var.db;
    const input = await body(c, S.scheduleInput);
    const existing = await db.select().from(schedules).where(eq(schedules.id, c.req.param('id'))).get();
    if (!existing) throw new HttpError(404, 'Schedule not found');
    const payee = input.transferAccountId ? null : await payeeId(db, input.payee);
    const rescheduled = input.startDate !== existing.startDate || input.frequency !== existing.frequency || input.interval !== existing.interval;
    const t = await today(db);
    const next = rescheduled
      ? (input.startDate >= t ? input.startDate : nextOccurrence(input.startDate, input.frequency, input.interval, addDays(t, -1)))
      : existing.nextDate;
    const [row] = await db.update(schedules).set({
      accountId: input.accountId, transferAccountId: input.transferAccountId ?? null, payeeId: payee?.id ?? null, categoryId: input.categoryId ?? null,
      amount: input.amount, memo: input.memo ?? null, frequency: input.frequency, interval: input.interval, startDate: input.startDate,
      nextDate: next, endDate: input.endDate ?? null, autoPost: input.autoPost,
    }).where(eq(schedules.id, existing.id)).returning();
    return c.json(row);
  })
  .delete('/schedules/:id', async (c) => {
    await c.var.db.delete(schedules).where(eq(schedules.id, c.req.param('id')));
    return c.json({ ok: true });
  })
  .post('/schedules/:id/post', async (c) => {
    const posted = await postSchedule(c.var.db, c.req.param('id'), '9999-12-31', { once: true });
    return c.json({ posted });
  })
  .post('/schedules/:id/skip', async (c) => {
    const db = c.var.db;
    const s = await db.select().from(schedules).where(eq(schedules.id, c.req.param('id'))).get();
    if (!s) throw new HttpError(404, 'Schedule not found');
    const next = nextOccurrence(s.startDate, s.frequency, s.interval, s.nextDate);
    if (s.endDate && next > s.endDate) await db.delete(schedules).where(eq(schedules.id, s.id));
    else await db.update(schedules).set({ nextDate: next }).where(eq(schedules.id, s.id));
    return c.json({ nextDate: next });
  })

  // ---------- reports ----------
  .get('/reports/spending', async (c) => {
    const db = c.var.db;
    const from = S.isoDate.parse(c.req.query('from'));
    const to = S.isoDate.parse(c.req.query('to'));
    const rows = await db.all<{ categoryId: string; total: number }>(sql`
      SELECT c AS categoryId, sum(v) AS total FROM (
        SELECT t.category_id AS c, t.amount_base AS v FROM transactions t WHERE t.is_split = 0 AND t.date BETWEEN ${from} AND ${to}
        UNION ALL
        SELECT s.category_id, s.amount_base FROM splits s JOIN transactions t ON t.id = s.transaction_id WHERE t.date BETWEEN ${from} AND ${to}
      ) x JOIN categories ON categories.id = x.c JOIN category_groups g ON g.id = categories.group_id
      WHERE g.is_income = 0 GROUP BY c ORDER BY total ASC`);
    const payeeRows = await db.all<{ payee: string; total: number }>(sql`
      SELECT p.name AS payee, sum(t.amount_base) AS total FROM transactions t JOIN payees p ON p.id = t.payee_id
       WHERE t.date BETWEEN ${from} AND ${to} AND t.amount < 0 AND t.transfer_id IS NULL
       GROUP BY p.id ORDER BY total ASC LIMIT 10`);
    return c.json({ categories: rows, payees: payeeRows });
  })
  .get('/reports/cashflow', async (c) => {
    const db = c.var.db;
    const months = Math.min(Number(c.req.query('months')) || 12, 60);
    const end = monthOf(await today(db));
    const start = addMonths(end, -(months - 1));
    const rows = await db.all<{ m: string; income: number; expense: number }>(sql`
      SELECT m, sum(case when kind = 'income' or (kind = 'none' and v > 0) then v else 0 end) AS income,
                sum(case when kind = 'expense' or (kind = 'none' and v < 0) then -v else 0 end) AS expense
        FROM (
          SELECT substr(t.date, 1, 7) AS m, t.amount_base AS v,
                 case when c.id is null then 'none' when g.is_income = 1 then 'income' else 'expense' end AS kind
            FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN category_groups g ON g.id = c.group_id
           WHERE t.is_split = 0 AND (t.transfer_id IS NULL OR t.category_id IS NOT NULL) AND t.date >= ${start + '-01'}
             AND NOT EXISTS (SELECT 1 FROM payees p WHERE p.id = t.payee_id AND p.name IN ('Starting balance', 'Reconciliation adjustment'))
          UNION ALL
          SELECT substr(t.date, 1, 7), s.amount_base,
                 case when c.id is null then 'none' when g.is_income = 1 then 'income' else 'expense' end
            FROM splits s JOIN transactions t ON t.id = s.transaction_id LEFT JOIN categories c ON c.id = s.category_id
            LEFT JOIN category_groups g ON g.id = c.group_id
           WHERE t.date >= ${start + '-01'}
        ) GROUP BY m ORDER BY m`);
    const out = [];
    for (let m = start; m <= end; m = addMonths(m, 1)) {
      const r = rows.find((x) => x.m === m);
      out.push({ month: m, income: r?.income ?? 0, expense: r?.expense ?? 0 });
    }
    return c.json(out);
  })
  .get('/reports/networth', async (c) => {
    const db = c.var.db;
    const months = Math.min(Number(c.req.query('months')) || 12, 60);
    const end = monthOf(await today(db));
    const start = addMonths(end, -(months - 1));
    const base = await baseCurrency(db);
    const accs = await db.select().from(accounts).all();
    const rows = await db.all<{ accountId: string; m: string; v: number }>(sql`
      SELECT account_id AS accountId, substr(date, 1, 7) AS m, sum(amount) AS v FROM transactions GROUP BY account_id, m`);
    const book = await rateBook(db, [base, ...accs.map((a) => a.currency)], `${start}-01`, lastDayOfMonth(end));
    const now = await today(db);
    const out = [];
    for (let m = start; m <= end; m = addMonths(m, 1)) {
      let assets = 0, debts = 0;
      const date = m === end ? now : lastDayOfMonth(m);
      for (const a of accs) {
        const native = rows.filter((r) => r.accountId === a.id && r.m <= m).reduce((s, r) => s + r.v, 0);
        const v = book.convert(native, a.currency, base, date);
        if (v >= 0) assets += v; else debts += -v;
      }
      out.push({ month: m, assets, debts, net: assets - debts });
    }
    return c.json(out);
  })

  // ---------- export ----------
  .get('/export.json', async (c) => {
    const db = c.var.db;
    const tables = ['settings', 'accounts', 'category_groups', 'categories', 'payees', 'tags', 'transactions', 'splits', 'transaction_tags', 'budgets', 'schedules'];
    const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), version: 1 };
    for (const t of tables) out[t] = await db.all(sql.raw(`SELECT * FROM ${t}`));
    c.header('content-disposition', `attachment; filename="budgeting-${await today(db)}.json"`);
    return c.json(out);
  })
  .get('/export.csv', async (c) => {
    const db = c.var.db;
    const rows = await db.all<Record<string, string | number | null>>(sql`
      SELECT t.date, a.name AS account, coalesce(p.name, case when t.transfer_id is not null then 'Transfer: ' || oa.name end) AS payee,
             case when t.is_split = 1 then 'Split' else c.name end AS category, t.memo, t.amount, a.currency, t.amount_base, t.cleared,
             (SELECT group_concat(g.name, ' ') FROM transaction_tags tt JOIN tags g ON g.id = tt.tag_id WHERE tt.transaction_id = t.id) AS tags
        FROM transactions t JOIN accounts a ON a.id = t.account_id LEFT JOIN payees p ON p.id = t.payee_id
        LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN transactions o ON o.id = t.transfer_id LEFT JOIN accounts oa ON oa.id = o.account_id
       ORDER BY t.date, t.created_at`);
    const esc = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const header = ['date', 'account', 'payee', 'category', 'memo', 'amount', 'currency', 'amount_base', 'cleared', 'tags'];
    const lines = [header.join(','), ...rows.map((r) => [r.date, r.account, r.payee, r.category, r.memo, Number(r.amount) / 100, r.currency, Number(r.amount_base) / 100, r.cleared, r.tags].map(esc).join(','))];
    return new Response(lines.join('\n'), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="transactions-${await today(db)}.csv"` },
    });
  })
  .delete('/tags/:id', async (c) => {
    await c.var.db.delete(tags).where(eq(tags.id, c.req.param('id')));
    return c.json({ ok: true });
  });
