import { describe, expect, it } from 'vitest';

import { formatPercentOfTotal, shareOfBudgeted } from './percentOfBudgeted';

describe('formatPercentOfTotal', () => {
  it('gives the share of the total to one decimal place', () => {
    expect(formatPercentOfTotal(668378, 3150186)).toBe('21.2%');
  });

  it('reads as a dash when the month budgets nothing', () => {
    expect(formatPercentOfTotal(0, 0)).toBe('--');
  });
});

describe('shareOfBudgeted', () => {
  it('reports the committed amount when nothing is being typed', () => {
    expect(shareOfBudgeted(40000, null, 303000)).toBe('13.2%');
  });

  it('counts the typed amount in the total it divides by', () => {
    // 800.00 of a month that budgeted 400.00 for this category and 3,030.00
    // in all: 80000 / (303000 - 40000 + 80000).
    expect(shareOfBudgeted(40000, 80000, 303000)).toBe('23.3%');
  });
});
