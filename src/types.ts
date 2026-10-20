export interface Account {
  id: string; name: string; type: string; currency: string; onBudget: boolean; closed: boolean; sort: number; note: string | null;
  balance: number; cleared: number; transactionCount: number; balanceBase: number | null;
}
export interface Category {
  id: string; groupId: string; name: string; sort: number; hidden: boolean;
  targetType: 'none' | 'monthly' | 'by_date'; targetAmount: number; targetDate: string | null; note: string | null;
}
export interface Group { id: string; name: string; isIncome: boolean; sort: number; hidden: boolean; categories: Category[] }
export interface Payee { id: string; name: string; defaultCategoryId: string | null; count: number }
export interface Bootstrap {
  settings: { baseCurrency: string; timeZone: string };
  accounts: Account[];
  groups: Group[];
  payees: Payee[];
  tags: { id: string; name: string }[];
  rates: Record<string, number>;
  uncategorized: number;
}
export interface Split { id: string; categoryId: string | null; amount: number; memo: string | null }
export interface Tx {
  id: string; accountId: string; date: string; amount: number; amountBase: number; payeeId: string | null; payee: string | null;
  categoryId: string | null; isSplit: boolean; transferId: string | null; transferAccountId: string | null; memo: string | null;
  cleared: 'uncleared' | 'cleared' | 'reconciled'; scheduleId: string | null; running: number; tags: string[]; splits: Split[];
}
export interface CategoryMonth { assigned: number; activity: number; carryover: number; available: number; underfunded: number }
export interface BudgetMonth {
  month: string; income: number; assigned: number; activity: number; overspentLastMonth: number; readyToAssign: number;
  available: number; underfunded: number; categories: Record<string, CategoryMonth>;
}
export interface Schedule {
  id: string; accountId: string; transferAccountId: string | null; payeeId: string | null; payee: string | null; categoryId: string | null;
  amount: number; memo: string | null; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number;
  startDate: string; nextDate: string; endDate: string | null; autoPost: boolean;
}
