import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Money is stored as integer minor units (cents). Dates are 'YYYY-MM-DD', months 'YYYY-MM'.
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => integer('created_at').notNull().$defaultFn(() => Date.now());

export const users = sqliteTable('users', {
  id: id(),
  // Stable identity of the sign-in method, e.g. 'email:me@example.com'.
  subject: text('subject').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  picture: text('picture'),
  createdAt: createdAt(),
});

export const sessions = sqliteTable('sessions', {
  // SHA-256 of the cookie token, so a database leak can't be replayed as a session.
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: createdAt(),
  userAgent: text('user_agent'),
});

// Failed and successful sign-ins, for rate limiting.
export const loginAttempts = sqliteTable('login_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ip: text('ip').notNull(),
  at: integer('at').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
}, (t) => [index('login_attempts_ip_at').on(t.ip, t.at), index('login_attempts_at').on(t.at)]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const ACCOUNT_TYPES = ['checking', 'savings', 'cash', 'credit', 'investment', 'loan', 'other'] as const;

export const accounts = sqliteTable('accounts', {
  id: id(),
  name: text('name').notNull(),
  type: text('type', { enum: ACCOUNT_TYPES }).notNull(),
  currency: text('currency').notNull(),
  onBudget: integer('on_budget', { mode: 'boolean' }).notNull().default(true),
  closed: integer('closed', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  note: text('note'),
  createdAt: createdAt(),
});

export const categoryGroups = sqliteTable('category_groups', {
  id: id(),
  name: text('name').notNull(),
  isIncome: integer('is_income', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
});

export const TARGET_TYPES = ['none', 'monthly', 'by_date'] as const;

export const categories = sqliteTable('categories', {
  id: id(),
  groupId: text('group_id').notNull().references(() => categoryGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  targetType: text('target_type', { enum: TARGET_TYPES }).notNull().default('none'),
  targetAmount: integer('target_amount').notNull().default(0),
  targetDate: text('target_date'),
  note: text('note'),
});

export const payees = sqliteTable('payees', {
  id: id(),
  name: text('name').notNull().unique(),
  // Rule: new transactions for this payee get this category unless one is given.
  defaultCategoryId: text('default_category_id').references(() => categories.id, { onDelete: 'set null' }),
});

export const tags = sqliteTable('tags', {
  id: id(),
  name: text('name').notNull().unique(),
});

export const CLEARED = ['uncleared', 'cleared', 'reconciled'] as const;

export const transactions = sqliteTable('transactions', {
  id: id(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  // In the account's currency; negative is an outflow.
  amount: integer('amount').notNull(),
  // In the base currency at the transaction date's rate; drives budgets and reports.
  amountBase: integer('amount_base').notNull(),
  payeeId: text('payee_id').references(() => payees.id, { onDelete: 'set null' }),
  // Null when uncategorized, split (see splits) or an on-budget transfer.
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  isSplit: integer('is_split', { mode: 'boolean' }).notNull().default(false),
  // The other half of a transfer.
  transferId: text('transfer_id'),
  memo: text('memo'),
  cleared: text('cleared', { enum: CLEARED }).notNull().default('uncleared'),
  importId: text('import_id'),
  scheduleId: text('schedule_id'),
  createdAt: createdAt(),
  updatedAt: integer('updated_at').notNull().$defaultFn(() => Date.now()),
}, (t) => [
  index('tx_account_date').on(t.accountId, t.date),
  index('tx_date').on(t.date),
  index('tx_category').on(t.categoryId),
  index('tx_payee').on(t.payeeId),
  uniqueIndex('tx_import').on(t.accountId, t.importId),
]);

export const splits = sqliteTable('splits', {
  id: id(),
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(),
  amountBase: integer('amount_base').notNull(),
  memo: text('memo'),
}, (t) => [index('split_tx').on(t.transactionId), index('split_category').on(t.categoryId)]);

export const transactionTags = sqliteTable('transaction_tags', {
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.transactionId, t.tagId] }), index('tt_tag').on(t.tagId)]);

export const budgets = sqliteTable('budgets', {
  month: text('month').notNull(),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  assigned: integer('assigned').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.month, t.categoryId] })]);

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export const schedules = sqliteTable('schedules', {
  id: id(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  transferAccountId: text('transfer_account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  payeeId: text('payee_id').references(() => payees.id, { onDelete: 'set null' }),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  amount: integer('amount').notNull(),
  memo: text('memo'),
  frequency: text('frequency', { enum: FREQUENCIES }).notNull(),
  interval: integer('interval').notNull().default(1),
  startDate: text('start_date').notNull(),
  nextDate: text('next_date').notNull(),
  endDate: text('end_date'),
  autoPost: integer('auto_post', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
});

// Units of `currency` per 1 EUR (ECB convention). date '0000-00-00' marks a manual rate.
export const fxRates = sqliteTable('fx_rates', {
  date: text('date').notNull(),
  currency: text('currency').notNull(),
  rate: real('rate').notNull(),
}, (t) => [primaryKey({ columns: [t.currency, t.date] })]);
