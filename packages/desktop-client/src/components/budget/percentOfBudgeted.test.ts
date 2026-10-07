import { describe, expect, it } from 'vitest';

import { formatPercentOfTotal } from './percentOfBudgeted';

describe('formatPercentOfTotal', () => {
  it('gives the share of the total to one decimal place', () => {
    expect(formatPercentOfTotal(668378, 3150186)).toBe('21.2%');
  });

  it('reads as a dash when the month budgets nothing', () => {
    expect(formatPercentOfTotal(0, 0)).toBe('--');
  });
});
