// Envelope budgeting, the YNAB / Actual Budget way.
//
// Each month every category gets `assigned` money and `activity` (its transactions). What's left,
// `available`, carries into the next month when positive. When a category ends a month negative
// (overspent), it restarts at zero and the overspending comes out of next month's "ready to assign".
//
// readyToAssign(M) = income through M − assigned through M − overspending in months before M.
// "Income" is everything that reaches on-budget accounts without an expense category: income
// categories plus uncategorized money. So ready to assign + Σ available = on-budget cash.

import { addMonths, monthsBetween } from './dates';

export interface BudgetCategory {
  id: string;
  isIncome: boolean;
  targetType: 'none' | 'monthly' | 'by_date';
  targetAmount: number;
  targetDate: string | null; // 'YYYY-MM' or 'YYYY-MM-DD'
}

export interface BudgetInput {
  categories: BudgetCategory[];
  /** month → categoryId → cents */
  assigned: Record<string, Record<string, number>>;
  /** month → categoryId → cents (base currency, signed). Key '' is uncategorized. */
  activity: Record<string, Record<string, number>>;
}

export interface CategoryMonth {
  assigned: number;
  activity: number;
  carryover: number;
  available: number;
  /** How much more to assign this month to stay on target (0 when funded or no target). */
  underfunded: number;
}

export interface MonthSummary {
  month: string;
  income: number;
  assigned: number;
  activity: number;
  overspentLastMonth: number;
  readyToAssign: number;
  available: number;
  underfunded: number;
  categories: Record<string, CategoryMonth>;
}

export function computeBudget(input: BudgetInput, month: string): MonthSummary {
  const months = [...Object.keys(input.assigned), ...Object.keys(input.activity)].filter((m) => m <= month).sort();
  const first = months[0] ?? month;
  const expense = input.categories.filter((c) => !c.isIncome);
  const expenseIds = new Set(expense.map((c) => c.id));

  const prevAvailable = new Map<string, number>();
  let cumIncome = 0;
  let cumAssigned = 0;
  let cumOverspent = 0; // overspending of all months before m
  let prevOverspent = 0; // overspending of month m − 1
  let summary!: MonthSummary;

  for (let m = first; m <= month; m = addMonths(m, 1)) {
    const assigned = input.assigned[m] ?? {};
    const activity = input.activity[m] ?? {};
    let income = 0;
    for (const [cat, amt] of Object.entries(activity)) {
      if (!expenseIds.has(cat)) income += amt;
    }
    const categories: Record<string, CategoryMonth> = {};
    let monthAssigned = 0, monthActivity = 0, monthAvailable = 0, monthUnderfunded = 0, overspentNow = 0;

    for (const c of expense) {
      const carryover = Math.max(prevAvailable.get(c.id) ?? 0, 0);
      const a = assigned[c.id] ?? 0;
      const act = activity[c.id] ?? 0;
      const available = carryover + a + act;
      const underfunded = targetUnderfunded(c, m, carryover, a);
      categories[c.id] = { assigned: a, activity: act, carryover, available, underfunded };
      prevAvailable.set(c.id, available);
      monthAssigned += a;
      monthActivity += act;
      monthAvailable += available;
      monthUnderfunded += underfunded;
      if (available < 0) overspentNow += -available;
    }

    cumIncome += income;
    cumAssigned += monthAssigned;
    summary = {
      month: m,
      income,
      assigned: monthAssigned,
      activity: monthActivity,
      overspentLastMonth: prevOverspent,
      readyToAssign: cumIncome - cumAssigned - cumOverspent,
      available: monthAvailable,
      underfunded: monthUnderfunded,
      categories,
    };
    prevOverspent = overspentNow;
    cumOverspent += overspentNow;
  }
  return summary;
}

export function targetUnderfunded(c: BudgetCategory, month: string, carryover: number, assigned: number) {
  if (c.targetType === 'monthly') return Math.max(c.targetAmount - assigned, 0);
  if (c.targetType === 'by_date' && c.targetDate) {
    const monthsLeft = monthsBetween(month, c.targetDate.slice(0, 7)) + 1;
    const remaining = c.targetAmount - carryover;
    if (remaining <= 0) return 0;
    const needed = monthsLeft <= 1 ? remaining : Math.ceil(remaining / monthsLeft);
    return Math.max(needed - assigned, 0);
  }
  return 0;
}
