import { describe, expect, it } from 'vitest';

import {
  accruedToDate,
  settleReservations,
  type ReservationClaim,
} from './reservations';

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
  it('splits a balance into reserved and available', () => {
    const claims = [claim('Amex Plat AF', 89500, 12, 4, '2026-12-01')];
    const r = settleReservations(100000, claims);

    expect(r.reserved).toBeCloseTo(89500 * (8 / 12), 6); // 8 of 12 months elapsed
    expect(r.available).toBeCloseTo(100000 - r.reserved, 6);
    expect(r.claims[0].onTrack).toBe(true);
    expect(r.shortfall).toBe(0);
  });

  it('reports a shortfall rather than overstating what is covered', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')]; // needs 800.00
    const r = settleReservations(50000, claims);

    expect(r.reserved).toBe(50000);
    expect(r.available).toBe(0);
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

  it('leaves the excess available once every claim is covered', () => {
    const claims = [claim('Domain', 1658, 12, 9, '2027-05-01')];
    const r = settleReservations(500000, claims);

    expect(r.shortfall).toBe(0);
    expect(r.available).toBe(500000 - r.reserved);
    expect(r.available).toBeGreaterThan(0);
  });

  it('never reports negative reserved when the category is overspent', () => {
    const claims = [claim('Taxes', 120000, 12, 4, '2027-01-01')];
    const r = settleReservations(-5000, claims);

    expect(r.reserved).toBe(0);
    expect(r.available).toBe(-5000);
    expect(r.claims[0].shortfall).toBe(80000);
  });

  it('treats a category with no claims as entirely available', () => {
    const r = settleReservations(118500, []);
    expect(r.reserved).toBe(0);
    expect(r.available).toBe(118500);
    expect(r.claims).toEqual([]);
  });

  it('reserved plus available always equals the balance', () => {
    const claims = [
      claim('Epic Pass', 80000, 12, 0, '2026-09-01'),
      claim('Christmas', 75000, 12, 2, '2026-11-01'),
      claim('Anniversary', 75000, 12, 9, '2027-06-01'),
    ];
    for (const balance of [0, 1000, 148391, 500000, -2500]) {
      const r = settleReservations(balance, claims);
      expect(r.reserved + r.available).toBeCloseTo(balance, 6);
    }
  });
});
