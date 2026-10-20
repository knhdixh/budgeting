import { describe, expect, it } from 'vitest';
import { convert, formatMoney, parseMoney } from '../shared/money';

describe('parseMoney', () => {
  it.each([
    ['12', 1200], ['12.5', 1250], ['12,50', 1250], ['1 234,56', 123456], ['1,234.56', 123456], ['1.234,56', 123456],
    ['1,234', 123400], ['-8', -800], ['−8.10', -810], ['€ 12', 1200], ['12.40+3', 1540], ['10-2.5', 750], ['.5', 50],
  ])('%s → %i', (input, cents) => expect(parseMoney(input)).toBe(cents));

  it.each(['', 'abc', '-', '+'])('rejects %j', (input) => expect(parseMoney(input)).toBeNull());
});

describe('formatMoney', () => {
  it('formats with a real minus sign', () => {
    expect(formatMoney(-123456, 'EUR')).toBe('−€1,234.56');
    expect(formatMoney(500, 'USD', { sign: true })).toBe('+US$5.00');
  });
});

describe('convert', () => {
  it('converts through EUR rates', () => {
    expect(convert(10000, 1, 1.12)).toBe(11200); // EUR → USD
    expect(convert(11200, 1.12, 1)).toBe(10000); // USD → EUR
    expect(convert(1000, 1.12, 11.5)).toBe(10268); // USD → SEK
  });
});
