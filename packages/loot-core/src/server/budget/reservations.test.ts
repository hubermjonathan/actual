import { describe, expect, it } from 'vitest';

import { accruedToDate, settleReservations } from './reservations';
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

  it('always returns whole cents', () => {
    // 1,053.00 over 6 months does not divide evenly.
    const c = claim('BMW Insurance', 105300, 6, 4, '2027-01-01');
    expect(Number.isInteger(accruedToDate(c))).toBe(true);
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

  it('reports a shortfall rather than overstating what is covered', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')]; // needs 800.00
    const r = settleReservations(50000, claims);

    expect(r.reserved).toBe(50000);
    expect(r.spare).toBe(0);
    expect(r.claims[0].shortfall).toBe(30000);
    expect(r.claims[0].onTrack).toBe(false);
  });

  it('covers claims in due-date order, matching the budget allocator', () => {
    const claims = [
      claim('Later', 120000, 12, 6, '2027-03-01'), // needs 600.00
      claim('Sooner', 60000, 12, 6, '2026-12-01'), // needs 300.00
    ];
    const r = settleReservations(30000, claims);

    expect(r.claims[0].name).toBe('Sooner');
    expect(r.claims[0].reserved).toBe(30000);
    expect(r.claims[0].onTrack).toBe(true);
    expect(r.claims[1].name).toBe('Later');
    expect(r.claims[1].reserved).toBe(0);
    expect(r.claims[1].shortfall).toBe(60000);
  });

  it('leaves the excess spare once every claim is covered', () => {
    const claims = [claim('Domain', 1658, 12, 9, '2027-05-01')];
    const r = settleReservations(500000, claims);

    expect(r.shortfall).toBe(0);
    expect(r.spare).toBe(500000 - r.reserved);
    expect(r.spare).toBeGreaterThan(0);
  });

  it('never reports negative reserved when the category is overspent', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')];
    const r = settleReservations(-5000, claims);

    expect(r.reserved).toBe(0);
    expect(r.spare).toBe(-5000);
    expect(r.claims[0].shortfall).toBe(80000);
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

describe('allowances and status', () => {
  const groceries = [{ label: 'groceries', amount: 100000 }];

  it('keeps an allowance out of spare', () => {
    // Nothing is owed to a future cost, but the balance is this month's
    // grocery money — it is spendable, and it is not slack.
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

  it('reports the excess once allowances are covered', () => {
    const r = settleReservations(150000, [], groceries);
    expect(r.allowance).toBe(100000);
    expect(r.spare).toBe(50000);
    expect(r.status).toBe('ahead');
  });

  it('pays future costs before allowances', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')]; // needs 800.00
    const r = settleReservations(150000, claims, groceries);

    expect(r.reserved).toBe(80000);
    expect(r.allowance).toBe(70000); // what is left, short of the 1,000.00
    expect(r.spare).toBe(0);
  });

  it('reports behind when a claim is short, allowances notwithstanding', () => {
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
