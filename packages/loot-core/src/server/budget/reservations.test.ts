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
});

describe('accruedToDate', () => {
  it('accrues nothing when the whole period is still ahead', () => {
    expect(accruedToDate(claim('Taxes', 120000, 12, 12, '2027-09-01'))).toBe(0);
  });

  it('accrues the full target in the month it is due', () => {
    expect(accruedToDate(claim('Taxes', 120000, 12, 0, '2026-09-01'))).toBe(
      120000,
    );
  });

  it('accrues pro rata part way through', () => {
    // A 1,200.00 annual cost due in four months should be 8/12 funded.
    expect(accruedToDate(claim('Taxes', 120000, 12, 4, '2027-01-01'))).toBe(
      80000,
    );
  });

  it('never exceeds the target when a claim is overdue', () => {
    expect(accruedToDate(claim('Taxes', 120000, 12, -3, '2026-06-01'))).toBe(
      120000,
    );
  });

  it('handles a semiannual period', () => {
    // BMW Insurance: 1,053.00 every 6 months, due in 3.
    expect(
      accruedToDate(claim('BMW Insurance', 105300, 6, 3, '2026-11-01')),
    ).toBe(52650);
  });
});

describe('settleReservations', () => {
  it('splits a balance into reserved and spare', () => {
    const claims = [claim('Amex Plat AF', 89500, 12, 4, '2026-12-01')];
    const r = settleReservations(100000, claims);

    expect(r.reserved).toBe(Math.round(89500 * (8 / 12))); // 8 of 12 elapsed
    expect(Number.isInteger(r.reserved)).toBe(true);
    expect(r.spare).toBe(100000 - r.reserved);
    expect(r.claims[0].onTrack).toBe(true);
    expect(r.shortfall).toBe(0);
  });

  it('keeps a claim whole and reports the shortfall against the category', () => {
    // The claim needs 800.00 and the category holds 500.00. The claim is a
    // promise about a bill, so it keeps its full accrual; the 300.00 the
    // category cannot cover is reported once, as negative spare.
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')]; // needs 800.00
    const r = settleReservations(50000, claims);

    expect(r.reserved).toBe(80000);
    expect(r.spare).toBe(-30000);
    expect(r.shortfall).toBe(30000);
    expect(r.status).toBe('behind');
    expect(r.claims[0].reserved).toBe(80000);
    expect(r.claims[0].shortfall).toBe(0);
  });

  it('lists claims in due-date order and keeps every one of them whole', () => {
    // 300.00 in the category against 900.00 of claims. Neither claim is
    // reduced - the category is 600.00 behind, said once.
    const claims = [
      claim('Later', 120000, 12, 6, '2027-03-01'), // needs 600.00
      claim('Sooner', 60000, 12, 6, '2026-12-01'), // needs 300.00
    ];
    const r = settleReservations(30000, claims);

    expect(r.claims[0].name).toBe('Sooner');
    expect(r.claims[0].reserved).toBe(30000);
    expect(r.claims[1].name).toBe('Later');
    expect(r.claims[1].reserved).toBe(60000);
    expect(r.claims.every(c => c.onTrack)).toBe(true);
    expect(r.spare).toBe(-60000);
    expect(r.shortfall).toBe(60000);
  });

  it('leaves the excess spare once every claim is covered', () => {
    const claims = [claim('Domain', 1658, 12, 9, '2027-05-01')];
    const r = settleReservations(500000, claims);

    expect(r.shortfall).toBe(0);
    expect(r.spare).toBe(500000 - r.reserved);
    expect(r.spare).toBeGreaterThan(0);
  });

  it('reports the whole hole when the category balance is negative', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')]; // needs 800.00
    const r = settleReservations(-5000, claims);

    expect(r.reserved).toBe(80000);
    expect(r.spare).toBe(-85000); // the 800.00 owed plus the 50.00 overdrawn
    expect(r.shortfall).toBe(85000);
  });

  it('treats a category with no claims as entirely spare', () => {
    const r = settleReservations(118500, []);
    expect(r.reserved).toBe(0);
    expect(r.spare).toBe(118500);
    expect(r.claims).toEqual([]);
  });

  it('reserved plus spare always equals the balance', () => {
    const claims = [
      claim('Epic Pass', 80000, 12, 0, '2026-09-01'),
      claim('Christmas', 75000, 12, 2, '2026-11-01'),
      claim('Anniversary', 75000, 12, 9, '2027-06-01'),
    ];
    for (const balance of [0, 1000, 148391, 500000, -2500]) {
      const r = settleReservations(balance, claims);
      expect(r.reserved + r.spare).toBe(balance);
      expect(Number.isInteger(r.reserved)).toBe(true);
      expect(Number.isInteger(r.spare)).toBe(true);
    }
  });
});

describe('a claim settled during the month', () => {
  it('carries the flag through settlement', () => {
    // Picklr: monthly, due on the 20th, paid on the 20th. The schedule has
    // moved on to next month so the claim accrues nothing - the same reading as
    // a claim that is simply not due yet. The flag is what tells them apart.
    const paid: ReservationClaim = {
      ...claim('Picklr', 19753, 1, 1, '2026-10-20'),
      settledThisMonth: true,
    };
    const r = settleReservations(0, [paid]);

    expect(r.claims[0].settledThisMonth).toBe(true);
    expect(r.claims[0].accrued).toBe(0);
    expect(r.reserved).toBe(0);
  });

  it('leaves the flag unset on a claim that is merely not due yet', () => {
    // Claude: monthly, next due the 11th of next month, never charged this
    // month. Accrues nothing, and nothing was spent.
    const r = settleReservations(0, [
      claim('Claude', 2211, 1, 1, '2026-10-11'),
    ]);

    expect(r.claims[0].settledThisMonth).toBeUndefined();
    expect(r.claims[0].accrued).toBe(0);
  });

  it('does not let a settled claim hold any of the balance', () => {
    // The reservation was spent on the bill. It must not take the balance a
    // second time.
    const paid: ReservationClaim = {
      ...claim('Picklr', 19753, 1, 1, '2026-10-20'),
      settledThisMonth: true,
    };
    const upcoming = claim('Christmas', 75000, 12, 2, '2026-11-01');
    const r = settleReservations(100000, [paid, upcoming]);

    expect(r.reserved).toBe(62500); // Christmas only
    expect(r.spare).toBe(37500);
  });
});

describe('allowances and status', () => {
  const groceries = [{ label: 'groceries', amount: 100000 }];

  it('keeps an allowance out of spare', () => {
    // Nothing is owed to a future cost, but the balance is this month's
    // grocery money. You can spend it, and it is not free money.
    const r = settleReservations(
      118500,
      [],
      [
        { label: 'groceries', amount: 100000 },
        { label: 'healthcare', amount: 15000 },
        { label: 'dog food', amount: 3500 },
      ],
    );

    expect(r.reserved).toBe(0);
    expect(r.allowance).toBe(118500);
    expect(r.spare).toBe(0);
    expect(r.status).toBe('onPace');
  });

  it('shrinks the allowance figure as it is spent', () => {
    const r = settleReservations(40000, [], groceries);
    expect(r.allowance).toBe(40000);
    expect(r.spare).toBe(0);
  });

  it('reports the size of the allowance separately from what is left', () => {
    // `allowance` falls as the month is spent. `allowanceTotal` does not, so a
    // caller can say "600.00 of 1,000.00 left" instead of showing one number
    // and leaving the reader to guess which it is.
    const r = settleReservations(60000, [], groceries);

    expect(r.allowanceTotal).toBe(100000);
    expect(r.allowance).toBe(60000);
  });

  it('keeps the allowance total when the allowance is fully spent', () => {
    // The case that hid Eating Out and Travel from the breakdown: spent to
    // zero is not the same as absent, and only `allowanceTotal` can tell them
    // apart.
    const r = settleReservations(0, [], groceries);

    expect(r.allowanceTotal).toBe(100000);
    expect(r.allowance).toBe(0);
  });

  it('reports an allowance total of zero when there are no allowances', () => {
    const r = settleReservations(50000, [], []);

    expect(r.allowanceTotal).toBe(0);
    expect(r.allowance).toBe(0);
  });

  it('reports the full allowance total even when claims take the balance', () => {
    // Claims hold their accrual first, so the allowance can be squeezed to
    // nothing while the month still asks for the whole 1,000.00.
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')]; // needs 800.00
    const r = settleReservations(80000, claims, groceries);

    expect(r.reserved).toBe(80000);
    expect(r.allowance).toBe(0);
    expect(r.allowanceTotal).toBe(100000);
  });

  it('reports the excess once allowances are covered', () => {
    const r = settleReservations(150000, [], groceries);
    expect(r.allowance).toBe(100000);
    expect(r.spare).toBe(50000);
    expect(r.status).toBe('ahead');
  });

  it('holds claims whole before the allowance takes what is left', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')]; // needs 800.00
    const r = settleReservations(150000, claims, groceries);

    expect(r.reserved).toBe(80000);
    expect(r.allowance).toBe(70000); // what is left, short of the 1,000.00
    expect(r.spare).toBe(0);
  });

  it('does not reduce a reservation when the allowance is overspent', () => {
    // The case this behaviour exists for. 650.00 of allowance, 672.42 spent,
    // and 2,588.01 of claims. The old engine covered claims from whatever the
    // balance had left and quietly cut the last one by 22.42. Now the claims
    // are whole and the 22.42 is visible.
    const claims = [
      claim('Christmas', 75000, 12, 2, '2026-11-01'), // needs 625.00
      claim('Jac Birthday', 75000, 12, 9, '2027-06-01'), // needs 187.50
    ];
    const allowance = [{ label: 'eating out', amount: 65000 }];
    const r = settleReservations(78258, claims, allowance); // 22.42 overspent

    expect(r.reserved).toBe(81250); // 625.00 + 187.50, both whole
    expect(r.claims.every(c => c.reserved === c.accrued)).toBe(true);
    expect(r.allowance).toBe(0);
    expect(r.spare).toBe(-2992);
    expect(r.status).toBe('behind');
  });

  it('reports behind when the balance cannot cover the claims', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')];
    const r = settleReservations(50000, claims, groceries);

    expect(r.status).toBe('behind');
    expect(r.shortfall).toBe(30000);
    expect(r.allowance).toBe(0);
  });

  it('reports funded when every future cost is fully covered', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')];
    const r = settleReservations(120000, claims);

    expect(r.target).toBe(120000);
    expect(r.status).toBe('funded');
  });

  it('rounds the total once, not each claim', () => {
    // Two claims whose exact accruals each end in a fraction of a cent.
    // Round-then-sum gives 9,047.75; sum-then-round gives 9,047.76, which is
    // what the budget engine actually contributed.
    const claims = [
      claim('Tractive', 11939, 12, 5, '2027-02-01'),
      claim('Epic Pass Deposit', 5000, 12, 7, '2027-04-01'),
    ];
    const r = settleReservations(1000000, claims);

    const roundThenSum = r.claims.reduce((s, c) => s + c.accrued, 0);
    expect(r.accrued).toBe(9048);
    expect(roundThenSum).toBe(9047);
    expect(Number.isInteger(r.reserved)).toBe(true);
  });

  it('has no status when there is nothing to measure', () => {
    // A plain savings category with no templates is neither ahead nor behind.
    expect(settleReservations(1625230, []).status).toBeNull();
    expect(settleReservations(0, []).status).toBeNull();
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

    expect(c.name).toBe('Savings');
    expect(c.target).toBe(75000);
    expect(c.nextDate).toBe('2026-11-01');
    expect(c.monthsRemaining).toBe(2);
    expect(c.monthlyRate).toBe(75000 / 12);
    // ten of twelve months elapsed
    expect(accruedToDate(c)).toBe(75000 - (75000 / 12) * 2);
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
    // The occasion happened; nothing was "paid", and the cycle still restarts.
    const [c] = getByReservationClaims([by()], '2026-12', 'Savings', 2);

    expect(c.nextDate).toBe('2027-11-01');
    expect(c.monthsRemaining).toBe(11);
    expect(accruedToDate(c)).toBe(75000 - (75000 / 12) * 11);
  });

  it('rolls forward across several missed cycles', () => {
    const [c] = getByReservationClaims(
      [by({ month: '2020-11' })],
      '2026-09',
      'Savings',
      2,
    );

    expect(c.nextDate).toBe('2026-11-01');
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

  it('settles beside a schedule claim, in due-date order', () => {
    const claims = [
      claim('BMW Insurance', 105300, 12, 3, '2026-12-01'),
      ...getByReservationClaims(
        [by({ label: 'christmas' })],
        '2026-09',
        'S',
        2,
      ),
    ];
    const r = settleReservations(200000, claims);

    expect(r.claims.map(c => c.name)).toEqual(['christmas', 'BMW Insurance']);
  });
});
