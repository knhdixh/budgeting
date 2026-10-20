import { formatMoney } from '../shared/money';

export const money = (cents: number, currency = 'EUR', sign = false) => formatMoney(cents, currency, { sign });

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const thisMonth = () => localToday().slice(0, 7);

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  checking: 'Checking', savings: 'Savings', cash: 'Cash', credit: 'Credit card', investment: 'Investment', loan: 'Loan', other: 'Other',
};

export function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}
