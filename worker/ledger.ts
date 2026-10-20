// Writing transactions: payees, transfers, splits, tags and base-currency amounts, atomically.

import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { z } from 'zod';
import { transactionInput } from '../shared/schemas';
import { accounts, categories, categoryGroups, payees, splits, tags, transactionTags, transactions } from './db/schema';
import type { DB } from './env';
import { baseCurrency, rateBook } from './fx';

export type TxInput = z.output<typeof transactionInput>;

export class HttpError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); }
}

export async function payeeId(db: DB, name: string | null | undefined) {
  const n = name?.trim();
  if (!n) return null;
  const existing = await db.select().from(payees).where(sql`lower(${payees.name}) = lower(${n})`).get();
  if (existing) return existing;
  const [row] = await db.insert(payees).values({ name: n }).returning();
  return row;
}

async function tagIds(db: DB, names: string[]) {
  const unique = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (!unique.length) return [];
  await db.run(sql`INSERT OR IGNORE INTO tags (id, name) SELECT lower(hex(randomblob(16))), value FROM json_each(${JSON.stringify(unique)})`);
  return (await db.select().from(tags).where(inArray(tags.name, unique)).all()).map((t) => t.id);
}

async function assertCategory(db: DB, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const c = await db.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).get();
  if (!c) throw new HttpError(400, 'Unknown category');
}

/**
 * Creates or replaces a transaction. Replacing keeps the id, rebuilds its splits, tags and
 * transfer counterpart, and runs as one batch so a failure leaves nothing half-written.
 */
export async function writeTransaction(db: DB, input: TxInput, existingId?: string) {
  const account = await db.select().from(accounts).where(eq(accounts.id, input.accountId)).get();
  if (!account) throw new HttpError(400, 'Unknown account');
  const other = input.transferAccountId
    ? await db.select().from(accounts).where(eq(accounts.id, input.transferAccountId)).get()
    : null;
  if (input.transferAccountId && !other) throw new HttpError(400, 'Unknown transfer account');
  await assertCategory(db, input.categoryId);
  for (const s of input.splits) await assertCategory(db, s.categoryId);

  const base = await baseCurrency(db);
  const book = await rateBook(db, [account.currency, base, other?.currency ?? base], input.date, input.date);
  const toBase = (cents: number, cur: string) => book.convert(cents, cur, base, input.date);

  const existing = existingId ? await db.select().from(transactions).where(eq(transactions.id, existingId)).get() : null;
  if (existingId && !existing) throw new HttpError(404, 'Transaction not found');

  const id = existingId ?? crypto.randomUUID();
  const statements: BatchItem<'sqlite'>[] = [];
  if (existing) {
    statements.push(db.delete(splits).where(eq(splits.transactionId, id)));
    statements.push(db.delete(transactionTags).where(eq(transactionTags.transactionId, id)));
    if (existing.transferId) statements.push(db.delete(transactions).where(eq(transactions.id, existing.transferId)));
  }

  let payee: { id: string; defaultCategoryId: string | null } | null = null;
  let categoryId = input.categoryId ?? null;
  let transferId: string | null = null;
  const isSplit = input.splits.length > 1;
  if (isSplit) categoryId = null;

  if (other) {
    // A transfer only touches the budget when money crosses between budget and tracking accounts;
    // then the category belongs to the on-budget side.
    transferId = crypto.randomUUID();
    const crossesBudget = account.onBudget !== other.onBudget;
    const otherAmount = input.transferAmount ?? book.convert(-input.amount, account.currency, other.currency, input.date);
    statements.push(db.insert(transactions).values({
      id: transferId,
      accountId: other.id,
      date: input.date,
      amount: otherAmount,
      amountBase: toBase(otherAmount, other.currency),
      categoryId: crossesBudget && other.onBudget ? categoryId : null,
      transferId: id,
      memo: input.memo ?? null,
      cleared: 'uncleared',
    }));
    categoryId = crossesBudget && account.onBudget ? categoryId : null;
  } else {
    payee = await payeeId(db, input.payee);
    if (!categoryId && !isSplit && payee?.defaultCategoryId && !existing) categoryId = payee.defaultCategoryId;
  }

  const row = {
    accountId: account.id,
    date: input.date,
    amount: input.amount,
    amountBase: toBase(input.amount, account.currency),
    payeeId: payee?.id ?? null,
    categoryId,
    isSplit,
    transferId,
    memo: input.memo ?? null,
    cleared: input.cleared,
    updatedAt: Date.now(),
  };
  statements.push(existing
    ? db.update(transactions).set(row).where(eq(transactions.id, id))
    : db.insert(transactions).values({ id, ...row }));

  if (isSplit) {
    statements.push(db.insert(splits).values(input.splits.map((s) => ({
      transactionId: id, categoryId: s.categoryId, amount: s.amount, amountBase: toBase(s.amount, account.currency), memo: s.memo ?? null,
    }))));
  }
  const tIds = await tagIds(db, input.tags);
  if (tIds.length) statements.push(db.insert(transactionTags).values(tIds.map((tagId) => ({ transactionId: id, tagId }))));

  // Learn the payee's usual category the first time one is chosen.
  if (payee && categoryId && !payee.defaultCategoryId) {
    statements.push(db.update(payees).set({ defaultCategoryId: categoryId }).where(eq(payees.id, payee.id)));
  }

  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
  return id;
}

/** Rebuilds the full input of a stored transaction so a partial change can go through writeTransaction. */
export async function loadInput(db: DB, id: string): Promise<TxInput> {
  const t = await db.select().from(transactions).where(eq(transactions.id, id)).get();
  if (!t) throw new HttpError(404, 'Transaction not found');
  const [payee, txSplits, txTags, counterpart] = await Promise.all([
    t.payeeId ? db.select().from(payees).where(eq(payees.id, t.payeeId)).get() : null,
    db.select().from(splits).where(eq(splits.transactionId, id)).all(),
    db.select({ name: tags.name }).from(transactionTags).innerJoin(tags, eq(tags.id, transactionTags.tagId)).where(eq(transactionTags.transactionId, id)).all(),
    t.transferId ? db.select().from(transactions).where(eq(transactions.id, t.transferId)).get() : null,
  ]);
  return {
    accountId: t.accountId,
    date: t.date,
    amount: t.amount,
    payee: payee?.name ?? null,
    categoryId: t.categoryId ?? counterpart?.categoryId ?? null,
    memo: t.memo,
    cleared: t.cleared,
    tags: txTags.map((x) => x.name),
    splits: txSplits.map((s) => ({ categoryId: s.categoryId, amount: s.amount, memo: s.memo })),
    transferAccountId: counterpart?.accountId ?? null,
    transferAmount: counterpart?.amount ?? null,
  };
}

export async function deleteTransactions(db: DB, ids: string[]) {
  if (!ids.length) return;
  const rows = await db.select({ transferId: transactions.transferId }).from(transactions).where(inArray(transactions.id, ids)).all();
  const all = [...new Set([...ids, ...rows.map((r) => r.transferId).filter((x): x is string => !!x)])];
  for (let i = 0; i < all.length; i += 90) await db.delete(transactions).where(inArray(transactions.id, all.slice(i, i + 90)));
}

/** The built-in income category that new money lands in. */
export async function inflowCategoryId(db: DB) {
  const row = await db.select({ id: categories.id }).from(categories)
    .innerJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))
    .where(and(eq(categoryGroups.isIncome, true), eq(categories.hidden, false)))
    .orderBy(categoryGroups.sort, categories.sort).limit(1).get();
  return row?.id ?? null;
}

export function where(...conds: (SQL | undefined)[]) {
  const list = conds.filter((c): c is SQL => !!c);
  return list.length ? and(...list) : undefined;
}
