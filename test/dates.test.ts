import { describe, expect, it } from 'vitest';
import { addMonths, lastDayOfMonth, monthsBetween, nextOccurrence, occurrence, todayIn } from '../shared/dates';

describe('dates', () => {
  it('adds months across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthsBetween('2026-10', '2027-03')).toBe(5);
  });

  it('knows month lengths', () => {
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
  });

  it('keeps the day of month and clamps short months', () => {
    expect(occurrence('2026-01-31', 'monthly', 1, 1)).toBe('2026-02-28');
    expect(occurrence('2026-01-31', 'monthly', 1, 2)).toBe('2026-03-31');
    expect(occurrence('2024-02-29', 'yearly', 1, 1)).toBe('2025-02-28');
    expect(occurrence('2026-10-20', 'weekly', 2, 1)).toBe('2026-11-03');
  });

  it('finds the next occurrence after a date', () => {
    expect(nextOccurrence('2026-01-15', 'monthly', 1, '2026-10-15')).toBe('2026-11-15');
    expect(nextOccurrence('2026-01-15', 'monthly', 1, '2026-10-14')).toBe('2026-10-15');
    expect(nextOccurrence('2020-03-01', 'daily', 1, '2026-10-20')).toBe('2026-10-21');
    expect(nextOccurrence('2027-01-01', 'yearly', 1, '2026-10-20')).toBe('2027-01-01');
  });

  it('computes today in a time zone', () => {
    const late = new Date('2026-10-20T22:30:00Z');
    expect(todayIn('Europe/Helsinki', late)).toBe('2026-10-21');
    expect(todayIn('America/New_York', late)).toBe('2026-10-20');
  });
});
