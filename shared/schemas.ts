import { z } from 'zod';
import { accountTypes } from './constants';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, 'Use YYYY-MM');
const cents = z.number().int().safe();
const currency = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');
const name = z.string().trim().min(1, 'Required').max(100);
const id = z.string().min(1).max(64);

export { accountTypes };

export const accountCreate = z.object({
  name,
  type: z.enum(accountTypes),
  currency,
  onBudget: z.boolean().default(true),
  startingBalance: cents.default(0),
  startingDate: isoDate,
  note: z.string().max(500).nullish(),
});

export const accountUpdate = z.object({
  name: name.optional(),
  type: z.enum(accountTypes).optional(),
  onBudget: z.boolean().optional(),
  closed: z.boolean().optional(),
  sort: z.number().int().optional(),
  note: z.string().max(500).nullish(),
});

export const splitInput = z.object({
  categoryId: id.nullable(),
  amount: cents,
  memo: z.string().max(200).nullish(),
});

export const transactionInput = z.object({
  accountId: id,
  date: isoDate,
  amount: cents,
  payee: z.string().trim().max(100).nullish(),
  categoryId: id.nullish(),
  memo: z.string().max(500).nullish(),
  cleared: z.enum(['uncleared', 'cleared', 'reconciled']).default('uncleared'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  splits: z.array(splitInput).max(50).default([]),
  transferAccountId: id.nullish(),
  /** Amount arriving in the other account, for transfers between currencies. */
  transferAmount: cents.nullish(),
}).superRefine((t, ctx) => {
  if (t.splits.length === 1) ctx.addIssue({ code: 'custom', message: 'A split needs at least two parts', path: ['splits'] });
  if (t.splits.length > 1 && t.splits.reduce((s, x) => s + x.amount, 0) !== t.amount) {
    ctx.addIssue({ code: 'custom', message: 'Split parts must add up to the amount', path: ['splits'] });
  }
  if (t.transferAccountId && t.transferAccountId === t.accountId) {
    ctx.addIssue({ code: 'custom', message: 'Pick a different account', path: ['transferAccountId'] });
  }
  if (t.transferAccountId && t.splits.length) {
    ctx.addIssue({ code: 'custom', message: 'Transfers cannot be split', path: ['splits'] });
  }
});

export type TransactionInput = z.input<typeof transactionInput>;

export const transactionPatch = z.object({
  date: isoDate.optional(),
  amount: cents.optional(),
  payee: z.string().trim().max(100).nullish(),
  categoryId: id.nullish(),
  memo: z.string().max(500).nullish(),
  cleared: z.enum(['uncleared', 'cleared', 'reconciled']).optional(),
  accountId: id.optional(),
});

export const bulkAction = z.object({
  ids: z.array(id).min(1).max(500),
  action: z.enum(['delete', 'categorize', 'clear', 'unclear']),
  categoryId: id.nullish(),
});

export const groupInput = z.object({ name, isIncome: z.boolean().optional(), hidden: z.boolean().optional(), sort: z.number().int().optional() });

export const categoryInput = z.object({
  groupId: id,
  name,
  hidden: z.boolean().optional(),
  sort: z.number().int().optional(),
  targetType: z.enum(['none', 'monthly', 'by_date']).optional(),
  targetAmount: cents.nonnegative().optional(),
  targetDate: z.union([isoMonth, isoDate]).nullish(),
  note: z.string().max(500).nullish(),
});

export const categoryUpdate = categoryInput.partial();

export const assignInput = z.object({ assigned: cents });
export const moveInput = z.object({ from: id.nullable(), to: id.nullable(), amount: cents.positive() });
export const autoAssignInput = z.object({ mode: z.enum(['targets', 'last_month', 'average']), categoryIds: z.array(id).optional() });

export const payeeUpdate = z.object({ name: name.optional(), defaultCategoryId: id.nullish() });
export const payeeMerge = z.object({ ids: z.array(id).min(1), into: id });

export const scheduleInput = z.object({
  accountId: id,
  transferAccountId: id.nullish(),
  payee: z.string().trim().max(100).nullish(),
  categoryId: id.nullish(),
  amount: cents,
  memo: z.string().max(500).nullish(),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(365).default(1),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  autoPost: z.boolean().default(false),
});

export const importInput = z.object({
  accountId: id,
  rows: z.array(z.object({
    date: isoDate,
    amount: cents,
    payee: z.string().trim().max(100).nullish(),
    memo: z.string().max(500).nullish(),
    category: z.string().trim().max(100).nullish(),
  })).min(1).max(5000),
});

export const reconcileInput = z.object({ balance: cents, date: isoDate });

export const settingsInput = z.object({
  baseCurrency: currency.optional(),
  timeZone: z.string().max(64).optional(),
});

export const manualRateInput = z.object({ currency, rate: z.number().positive().nullable() });

export { isoDate, isoMonth };
