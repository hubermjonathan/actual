import { describe, expect, it } from 'vitest';

import type { ByTemplate } from '#types/models/templates';

import {
  accruedToDate,
  getByReservationClaims,
  settleReservations,
} from './reservations';
import type { ReservationClaim } from './reservations';

const claim = (
  name: string,
  target: number,
  periodMonths: number,
  monthsRemaining: number,
  nextDate: string,
): ReservationClaim => ({
  name,
  target,
  nextDate,
  monthlyRate: target / periodMonths,
  monthsRemaining,
  fixed: false,
  settledThisMonth: false,
});

describe('accruedToDate', () => {
  it.each([
    ['nothing when the whole period is ahead', 12, 0],
    ['the full target in the month it is due', 0, 120000],
    ['pro rata part way through', 4, 80000],
    ['no more than the target when overdue', -3, 120000],
  ])('accrues %s', (_, monthsRemaining, expected) => {
    expect(
      accruedToDate(claim('Taxes', 120000, 12, monthsRemaining, '2027-01-01')),
    ).toBe(expected);
  });
});

describe('settleReservations', () => {
  // Taxes needs 800.00 of its 1,200.00 so far.
  it.each([
    [50000, 'behind', 80000, -30000, 30000],
    [80000, 'onPace', 80000, 0, 0],
    [100000, 'ahead', 80000, 20000, 0],
    [120000, 'funded', 80000, 40000, 0],
  ])(
    'with a balance of %i is %s',
    (balance, status, reserved, spare, shortfall) => {
      const r = settleReservations(balance, [
        claim('Taxes', 120000, 12, 4, '2027-01-01'),
      ]);

      expect(r).toMatchObject({ status, reserved, spare, shortfall });
    },
  );

  it('treats a category with no claims as all spare, with no status', () => {
    const r = settleReservations(118500, []);

    expect(r).toMatchObject({ reserved: 0, spare: 118500, status: null });
    expect(r.claims).toEqual([]);
  });

  it('keeps every claim whole, in due-date order, when the balance is short', () => {
    const claims = [
      claim('Later', 120000, 12, 6, '2027-03-01'), // needs 600.00
      claim('Sooner', 60000, 12, 6, '2026-12-01'), // needs 300.00
    ];
    const r = settleReservations(30000, claims);

    expect(r.claims.map(c => [c.name, c.reserved])).toEqual([
      ['Sooner', 30000],
      ['Later', 60000],
    ]);
    expect(r.spare).toBe(-60000);
  });

  it('rounds the total once, not each claim', () => {
    // Round-then-sum gives 9,047.75; the budget engine contributed 9,047.76.
    const claims = [
      claim('Tractive', 11939, 12, 5, '2027-02-01'),
      claim('Epic Pass Deposit', 5000, 12, 7, '2027-04-01'),
    ];
    const r = settleReservations(1000000, claims);

    expect(r.claims.reduce((s, c) => s + c.accrued, 0)).toBe(9047);
    expect(r.accrued).toBe(9048);
  });

  it('holds nothing for a claim settled this month', () => {
    const paid: ReservationClaim = {
      ...claim('Picklr', 19753, 1, 1, '2026-10-20'),
      settledThisMonth: true,
    };
    const upcoming = claim('Christmas', 75000, 12, 2, '2026-11-01');
    const r = settleReservations(100000, [paid, upcoming]);

    expect(r.claims.find(c => c.name === 'Picklr')).toMatchObject({
      settledThisMonth: true,
      reserved: 0,
    });
    expect(r.reserved).toBe(62500);
    expect(r.spare).toBe(37500);
  });
});

describe('getByReservationClaims', () => {
  const by = (overrides: Partial<ByTemplate> = {}): ByTemplate =>
    ({
      type: 'by',
      amount: 750,
      month: '2026-11',
      annual: true,
      repeat: 1,
      directive: 'template',
      priority: 0,
      ...overrides,
    }) as ByTemplate;

  it('turns a repeating target into a claim', () => {
    const [c] = getByReservationClaims([by()], '2026-09', 'Savings', 2);

    expect(c).toMatchObject({
      name: 'Savings',
      target: 75000,
      nextDate: '2026-11-01',
      monthsRemaining: 2,
      monthlyRate: 75000 / 12,
    });
  });

  it('names the claim from its label', () => {
    const [c] = getByReservationClaims(
      [by({ label: 'christmas' })],
      '2026-09',
      'Savings',
      2,
    );

    expect(c.name).toBe('christmas');
  });

  it('rolls the target forward once the date has passed', () => {
    // Nothing is "paid" for a goal, and the cycle still restarts.
    const [c] = getByReservationClaims([by()], '2026-12', 'Savings', 2);

    expect(c.nextDate).toBe('2027-11-01');
    expect(c.monthsRemaining).toBe(11);
  });

  it('reads a non-annual repeat as months', () => {
    const [c] = getByReservationClaims(
      [by({ annual: false, repeat: 6, month: '2026-10' })],
      '2026-09',
      'Savings',
      2,
    );

    expect(c.monthlyRate).toBe(75000 / 6);
  });

  it('ignores a one-off target, which has no cycle to reset', () => {
    expect(
      getByReservationClaims(
        [by({ annual: false, repeat: undefined })],
        '2026-09',
        'Savings',
        2,
      ),
    ).toEqual([]);
  });
});
