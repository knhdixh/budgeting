import { describe, expect, it } from 'vitest';
import { computeBudget, type BudgetCategory } from '../shared/budget';

const cat = (id: string, extra: Partial<BudgetCategory> = {}): BudgetCategory =>
  ({ id, isIncome: false, targetType: 'none', targetAmount: 0, targetDate: null, ...extra });
const categories = [cat('inc', { isIncome: true }), cat('food'), cat('rent'), cat('trip', { targetType: 'by_date', targetAmount: 120000, targetDate: '2026-12' })];

describe('computeBudget', () => {
  it('assigns income and tracks available money', () => {
    const s = computeBudget({
      categories,
      assigned: { '2026-10': { food: 40000, rent: 90000 } },
      activity: { '2026-10': { inc: 300000, food: -12000, rent: -90000 } },
    }, '2026-10');
    expect(s.readyToAssign).toBe(300000 - 130000);
    expect(s.categories.food.available).toBe(28000);
    expect(s.categories.rent.available).toBe(0);
  });

  it('rolls positive balances over and takes overspending from next month', () => {
    const input = {
      categories,
      assigned: { '2026-09': { food: 30000, rent: 10000 }, '2026-10': { food: 30000 } },
      activity: { '2026-09': { inc: 100000, food: -20000, rent: -15000 }, '2026-10': { food: -5000 } },
    };
    const sep = computeBudget(input, '2026-09');
    expect(sep.categories.rent.available).toBe(-5000);
    expect(sep.readyToAssign).toBe(60000);

    const oct = computeBudget(input, '2026-10');
    expect(oct.categories.food.carryover).toBe(10000);
    expect(oct.categories.food.available).toBe(35000);
    expect(oct.categories.rent.carryover).toBe(0); // overspending doesn't carry
    expect(oct.overspentLastMonth).toBe(5000);
    expect(oct.readyToAssign).toBe(100000 - 70000 - 5000);
  });

  it('counts uncategorized money as income so the books balance', () => {
    const s = computeBudget({ categories, assigned: {}, activity: { '2026-10': { '': 5000, food: -1000 } } }, '2026-10');
    // On-budget cash is 4000: ready to assign 5000 + food available −1000.
    expect(s.readyToAssign + s.available).toBe(4000);
  });

  it('works out what a by-date target still needs', () => {
    const s = computeBudget({ categories, assigned: { '2026-10': { trip: 10000 } }, activity: {} }, '2026-10');
    // 1200 € over Oct–Dec is 400 € a month; 100 € is assigned.
    expect(s.categories.trip.underfunded).toBe(30000);
    const monthly = computeBudget({ categories: [cat('gym', { targetType: 'monthly', targetAmount: 3000 })], assigned: {}, activity: {} }, '2026-10');
    expect(monthly.underfunded).toBe(3000);
  });

  it('handles months with no data at all', () => {
    const s = computeBudget({ categories, assigned: {}, activity: {} }, '2026-10');
    expect(s.readyToAssign).toBe(0);
    expect(s.month).toBe('2026-10');
  });
});
