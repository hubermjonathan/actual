// A reservation is a named claim inside a category for a known future cost.
//
// The problem it solves: a category's balance reads as spendable when part of
// it is really owed to an irregular cost that has not arrived yet. Splitting
// the balance into `reserved` and `spare` makes the number you read before
// spending the money you can actually spend.
//
// Everything here is DERIVED on read, never stored. A stored figure would drift
// the moment a transaction posts, an amount changes, or a budget cell is edited
// by hand, and there is no reliable place to invalidate it. Deriving from each
// claim's next due date also makes draw-down automatic: when a bill posts and
// the schedule rolls forward, that claim's accrual restarts on its own.

import * as monthUtils from '#shared/months';
import { amountToInteger } from '#shared/util';
import type { ByTemplate } from '#types/models/templates';

export type ReservationClaim = {
  /** Display name, from the schedule the claim tracks. */
  name: string;
  /** Full amount of the future cost. */
  target: number;
  /** Next occurrence, `YYYY-MM-DD`. Claims are settled in this order. */
  nextDate: string;
  /** Amount this claim accrues each month. */
  monthlyRate: number;
  /** Whole months until the cost lands. 0 means it is due this month. */
  monthsRemaining: number;
  /**
   * Written `[fixed]`: the claim accrues at a flat rate of its own rather than
   * sharing the category's pot. Reported so a caller can tell the two apart.
   */
  fixed?: boolean;
};

export type SettledClaim = ReservationClaim & {
  /** What should already be held for this claim by now. */
  accrued: number;
  /** How much of the balance actually covers it. Never exceeds `accrued`. */
  reserved: number;
  /** `accrued - reserved`. Non-zero means this claim is behind. */
  shortfall: number;
  onTrack: boolean;
};

/** What an allowance sets aside for this month, e.g. `#template 1000 [groceries]`. */
export type Allowance = {
  label: string;
  amount: number;
};

export type ReservationStatus = 'behind' | 'onPace' | 'ahead' | 'funded';

export type CategoryReservations = {
  balance: number;
  /** Portion of the balance owed to future costs. Not spendable now. */
  reserved: number;
  /**
   * Allowance money still sitting in the balance. Spendable — that is what an
   * allowance is for — but already committed, so it is not slack.
   */
  allowance: number;
  /** `balance - reserved - allowance` — beyond both future costs and allowances. */
  spare: number;
  /** What should be held across all claims, ignoring whether it is there. */
  accrued: number;
  /** `accrued - reserved` — how far behind the category is in total. */
  shortfall: number;
  /** Every claim's full future cost, the point at which nothing more is needed. */
  target: number;
  /** `null` when the category has nothing to measure against. */
  status: ReservationStatus | null;
  claims: SettledClaim[];
  allowances: Allowance[];
};

/**
 * How much of `target` should already be set aside.
 *
 * Derived as `target - monthlyRate * monthsRemaining`: whatever is still to be
 * saved is the rate times the months left, so everything else is owed already.
 * Expressing it this way reuses the engine's own contribution rate rather than
 * reimplementing period arithmetic, so the two cannot disagree.
 *
 * Deliberately NOT rounded per claim. The budget engine sums the exact rates and
 * rounds the total once, so rounding here first — round-then-sum against its
 * sum-then-round — leaves the category looking a cent ahead or behind for no
 * reason. Aggregates are rounded on the way out instead.
 */
export function accruedToDate(claim: ReservationClaim): number {
  const remaining = claim.monthlyRate * claim.monthsRemaining;
  return Math.min(claim.target, Math.max(0, claim.target - remaining));
}

/**
 * Settle a category's balance against its claims.
 *
 * Claims are covered in due-date order, matching how the budget's own sinking
 * allocator consumes a balance. A claim short of its accrual reports the gap
 * rather than silently borrowing from a later one.
 */
export function settleReservations(
  balance: number,
  claims: ReservationClaim[],
  allowances: Allowance[] = [],
): CategoryReservations {
  const ordered = [...claims].sort((a, b) => {
    const byDate = a.nextDate.localeCompare(b.nextDate);
    return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
  });

  let unallocated = Math.max(0, balance);
  // Settled exactly first: the engine sums exact rates and rounds the total
  // once, so rounding per claim here and summing those would leave the category
  // a cent ahead or behind for no reason.
  const exact = ordered.map(claim => {
    const accrued = accruedToDate(claim);
    const reserved = Math.min(unallocated, accrued);
    unallocated -= reserved;
    return { claim, accrued, reserved };
  });

  const reserved = Math.round(exact.reduce((sum, c) => sum + c.reserved, 0));
  const accrued = Math.round(exact.reduce((sum, c) => sum + c.accrued, 0));
  const target = exact.reduce((sum, c) => sum + c.claim.target, 0);
  const shortfall = Math.max(0, accrued - reserved);

  // Per-claim figures are for display and round individually, so their sum can
  // differ from the category total by a cent. The totals above are the
  // authoritative ones.
  const settled: SettledClaim[] = exact.map(c => ({
    ...c.claim,
    accrued: Math.round(c.accrued),
    reserved: Math.round(c.reserved),
    shortfall: Math.round(c.accrued - c.reserved),
    onTrack: c.accrued - c.reserved < 1,
  }));

  // Allowances take whatever the future costs have not. As the month's
  // allowance is spent the balance falls, and so does this — so it tracks what
  // is left of the allowance rather than what it started at.
  const allowanceTotal = allowances.reduce((sum, a) => sum + a.amount, 0);
  const allowance = Math.min(
    Math.max(0, balance - reserved),
    Math.max(0, allowanceTotal),
  );
  const spare = balance - reserved - allowance;

  // A category with no claims and no allowances has nothing to be ahead of.
  let status: ReservationStatus | null;
  if (settled.length === 0 && allowances.length === 0) {
    status = null;
  } else if (shortfall > 0) {
    status = 'behind';
  } else if (target > 0 && balance - allowance >= target) {
    status = 'funded';
  } else if (spare > 0) {
    status = 'ahead';
  } else {
    status = 'onPace';
  }

  return {
    balance,
    reserved,
    allowance,
    spare,
    accrued,
    shortfall,
    target,
    status,
    claims: settled,
    allowances,
  };
}

/**
 * Claims for savings targets that no bill will ever settle — Christmas, an
 * anniversary, a birthday.
 *
 * These come from the `by` template rather than a schedule, because the two
 * kinds of claim are closed by different things. A bill's cycle ends when the
 * payment posts, which is why schedule-backed claims read `schedules_next_date`.
 * An occasion's cycle ends when the **date passes** — Christmas happens whether
 * or not the money was spent — so the target month simply rolls forward by the
 * period, exactly as the budget engine's own `runBy` already does.
 *
 * Only repeating targets become claims. A one-off `#template 750 by 2026-12`
 * has no cycle to reset and no anchor for "what should be set aside by now",
 * so it is left alone.
 */
export function getByReservationClaims(
  templates: ByTemplate[],
  currentMonth: string,
  fallbackName: string,
  decimalPlaces: number,
): ReservationClaim[] {
  const claims: ReservationClaim[] = [];

  for (const template of templates) {
    const period = template.annual
      ? (template.repeat || 1) * 12
      : (template.repeat ?? null);
    if (!period) continue;

    // Roll the target forward until it is in the future, the same way `runBy`
    // resolves a target month that has already passed.
    let targetMonth = `${template.month}`;
    let monthsRemaining = monthUtils.differenceInCalendarMonths(
      targetMonth,
      currentMonth,
    );
    while (monthsRemaining < 0) {
      targetMonth = monthUtils.addMonths(targetMonth, period);
      monthsRemaining = monthUtils.differenceInCalendarMonths(
        targetMonth,
        currentMonth,
      );
    }

    const target = amountToInteger(template.amount, decimalPlaces);
    claims.push({
      name: template.label ?? fallbackName,
      target,
      nextDate: `${targetMonth}-01`,
      monthlyRate: target / period,
      monthsRemaining: Math.max(0, monthsRemaining),
    });
  }

  return claims;
}
