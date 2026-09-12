// A reservation is a named claim in a category for a known future cost.
//
// It solves this problem: a category balance looks like money you can spend,
// but part of it is owed to an irregular cost that has not arrived. When we
// divide the balance into `reserved` and `spare`, the number you read before
// you spend is the money you can spend.
//
// We calculate all of this on read. We never store it. A stored value would go
// out of date as soon as a transaction posts, an amount changes, or someone
// edits a budget cell, and there is no good place to clear it. We calculate
// from the next due date of each claim, which also makes the draw-down
// automatic. When a bill posts, the schedule moves forward and that claim
// starts to collect again from zero.

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
   * Written `[fixed]`. The claim collects at its own flat rate and does not
   * share the category pot. We report it so that a caller can tell the two
   * types apart.
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

/** The amount an allowance keeps for this month, for example `#template 1000 [groceries]`. */
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
   * Allowance money that is still in the balance. You can spend it, because
   * that is what an allowance is for. It is already promised, so it is not
   * free money.
   */
  allowance: number;
  /** `balance - reserved - allowance`. More than the future costs and the allowances need. */
  spare: number;
  /** What should be held across all claims, ignoring whether it is there. */
  accrued: number;
  /** `accrued - reserved`. The total amount the category is behind by. */
  shortfall: number;
  /** Every claim's full future cost, the point at which nothing more is needed. */
  target: number;
  /** `null` when the category has nothing to measure against. */
  status: ReservationStatus | null;
  claims: SettledClaim[];
  allowances: Allowance[];
};

/**
 * The part of `target` that you should already hold.
 *
 * We calculate `target - monthlyRate * monthsRemaining`. The amount still to
 * save is the rate times the months that are left, so you owe the rest now.
 * This uses the engine's own contribution rate. We do not repeat the period
 * arithmetic here, so the two cannot disagree.
 *
 * Do not round each claim here. The budget engine adds the exact rates and
 * rounds the total once. If we round first and then add, the category looks one
 * cent ahead or behind for no reason. We round the totals at the end instead.
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
  // Settle with exact values first. The engine adds exact rates and rounds the
  // total once. If we round each claim and then add, the category looks one
  // cent ahead or behind for no reason.
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

  // These per-claim values are for display, and each one rounds on its own.
  // Their sum can differ from the category total by one cent. Use the totals
  // above as the correct values.
  const settled: SettledClaim[] = exact.map(c => ({
    ...c.claim,
    accrued: Math.round(c.accrued),
    reserved: Math.round(c.reserved),
    shortfall: Math.round(c.accrued - c.reserved),
    onTrack: c.accrued - c.reserved < 1,
  }));

  // Allowances get the money that the future costs do not need. As you spend
  // the month's allowance, the balance falls and this value falls with it. It
  // shows what is left of the allowance, not the amount it started at.
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
 * Claims for savings targets that have no bill, such as Christmas, an
 * anniversary or a birthday.
 *
 * These come from the `by` template, not from a schedule, because the two types
 * of claim end their cycle in different ways. A bill cycle ends when the payment
 * posts, so schedule claims read `schedules_next_date`. An occasion cycle ends
 * when the **date passes**, because Christmas comes whether or not you spent
 * the money. The target month therefore moves forward by one period, in the
 * same way as the budget engine's `runBy`.
 *
 * Only a repeating target becomes a claim. A single `#template 750 by 2026-12`
 * has no cycle to reset. It also gives no way to say how much you should hold
 * by now, so we ignore it.
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
      : template.repeat;
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
      monthsRemaining,
    });
  }

  return claims;
}
