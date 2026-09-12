import { reservationsModel } from './api-models';
import type { CategoryReservationsResult } from './budget/goal-template';

function reservations(
  overrides: Partial<CategoryReservationsResult> = {},
): CategoryReservationsResult {
  return {
    categoryId: 'cat-1',
    categoryName: 'Needs',
    balance: 564579,
    reserved: 446079,
    allowance: 118500,
    spare: 0,
    accrued: 446079,
    shortfall: 0,
    target: 1053000,
    status: 'onPace',
    claims: [],
    allowances: [],
    ...overrides,
  };
}

describe('reservationsModel.toExternal', () => {
  it('publishes committed as reserved plus allowance', () => {
    const external = reservationsModel.toExternal(reservations());

    expect(external.committed).toBe(446079 + 118500);
    expect(external.committed).toBe(external.balance - external.spare);
  });

  it('reports a claim without the [fixed] flag as not fixed', () => {
    const external = reservationsModel.toExternal(
      reservations({
        claims: [
          {
            name: 'Taxes',
            target: 120000,
            nextDate: '2026-12-01',
            monthlyRate: 10000,
            monthsRemaining: 3,
            accrued: 90000,
            reserved: 90000,
            shortfall: 0,
            onTrack: true,
          },
          {
            name: 'BMW Insurance',
            target: 105300,
            nextDate: '2026-11-01',
            monthlyRate: 17550,
            monthsRemaining: 3,
            accrued: 52650,
            reserved: 52650,
            shortfall: 0,
            onTrack: true,
            fixed: true,
          },
        ],
      }),
    );

    // The core leaves `fixed` off a claim that does not carry it; the API
    // always publishes a boolean so a caller never has to check for undefined.
    expect(external.claims.map(c => c.fixed)).toEqual([false, true]);
  });
});
