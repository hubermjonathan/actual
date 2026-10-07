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
  fixed: boolean;
  /**
   * The bill this claim tracks fell due in the budget month and has been paid.
   * The reservation did its job and was spent.
   *
   * Such a claim accrues nothing, because it is collecting again from zero for
   * the next occurrence. Without this flag it is indistinguishable from a claim
   * that is simply not due yet, and a closed month cannot be read back: every
   * reservation that worked has erased itself.
   */
  settledThisMonth: boolean;
};

export type SettledClaim = ReservationClaim & {
  /** What should already be held for this claim by now. */
  accrued: number;
  /**
   * What this claim holds. Always equals `accrued`.
   *
   * A reservation is a promise about a bill that has not arrived. It is not
   * reduced because the category was overspent - that would move the
   * problem somewhere nobody is looking. When the balance cannot cover
   * everything, the category reports it once, in `spare`.
   */
  reserved: number;
};

export type ReservationStatus = 'behind' | 'onPace' | 'ahead' | 'funded';

export type CategoryReservations = {
  balance: number;
  /** Portion of the balance owed to future costs. Not spendable now. */
  reserved: number;
  /**
   * `balance - reserved`. The money no future cost needs, which is the money
   * you can spend.
   *
   * There is no allowance part. A `#template 1000 [groceries]` line only
   * budgets the category; once every allowance had its own category, carving
   * it out of the balance just restated the balance, and in a category that
   * also holds claims it hid money a claim had released.
   *
   * **Negative means overspent.** Claims keep their full accrual, so a month
   * spent past what is free shows the deficit here rather than quietly shrinking
   * a reservation.
   */
  spare: number;
  /** What should be held across all claims, ignoring whether it is there. */
  accrued: number;
  /**
   * How far the balance falls short of everything the category owes. `-spare`
   * when spare is negative, otherwise 0.
   */
  shortfall: number;
  /** Every claim's full future cost, the point at which nothing more is needed. */
  target: number;
  /** `null` when the category has nothing to measure against. */
  status: ReservationStatus | null;
  claims: SettledClaim[];
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
export function accruedToDate({
  target,
  monthlyRate,
  monthsRemaining,
}: Pick<
  ReservationClaim,
  'target' | 'monthlyRate' | 'monthsRemaining'
>): number {
  const remaining = monthlyRate * monthsRemaining;
  return Math.min(target, Math.max(0, target - remaining));
}

export function heldAtMonthStart(
  claim: Pick<ReservationClaim, 'target' | 'monthlyRate' | 'monthsRemaining'>,
): number {
  return accruedToDate({
    ...claim,
    monthsRemaining: claim.monthsRemaining + 1,
  });
}

/**
 * Settle a category's balance against its claims.
 *
 * **Claims hold their full accrual, whatever the balance.** Everything else is
 * `spare`, and anything missing lands there as a negative.
 *
 * Capping reservations at the balance meant overspending quietly reduced them,
 * in reverse due-date order, with nothing said - 22.42 of extra dinners became a
 * hole in a birthday fund. Now the category reports the deficit once, in one
 * place, and the user decides where to cover it from.
 */
export function settleReservations(
  balance: number,
  claims: ReservationClaim[],
): CategoryReservations {
  const ordered = [...claims].sort((a, b) => {
    const byDate = a.nextDate.localeCompare(b.nextDate);
    return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
  });

  // Settle with exact values first. The engine adds exact rates and rounds the
  // total once. If we round each claim and then add, the category looks one
  // cent ahead or behind for no reason.
  const exact = ordered.map(claim => {
    const accrued = accruedToDate(claim);
    return { claim, accrued, reserved: accrued };
  });

  const reserved = Math.round(exact.reduce((sum, c) => sum + c.reserved, 0));
  const accrued = Math.round(exact.reduce((sum, c) => sum + c.accrued, 0));
  const target = exact.reduce((sum, c) => sum + c.claim.target, 0);

  // These per-claim values are for display, and each one rounds on its own.
  // Their sum can differ from the category total by one cent. Use the totals
  // above as the correct values.
  const settled: SettledClaim[] = exact.map(c => ({
    ...c.claim,
    accrued: Math.round(c.accrued),
    reserved: Math.round(c.reserved),
  }));

  // `balance = reserved + spare` always holds.
  const spare = balance - reserved;
  const shortfall = Math.max(0, -spare);

  // Status describes the claims and nothing else. A category with none has
  // nothing to be on pace for, so it has no status, like one with no
  // templates.
  let status: ReservationStatus | null;
  if (settled.length === 0) {
    status = null;
  } else if (shortfall > 0) {
    status = 'behind';
  } else if (balance >= target) {
    status = 'funded';
  } else if (spare > 0) {
    status = 'ahead';
  } else {
    status = 'onPace';
  }

  return {
    balance,
    reserved,
    spare,
    accrued,
    shortfall,
    target,
    status,
    claims: settled,
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
      fixed: false,
      settledThisMonth: false,
    });
  }

  return claims;
}
