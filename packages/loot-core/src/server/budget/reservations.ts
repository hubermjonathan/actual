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
  /**
   * The bill this claim tracks fell due in the budget month and has been paid.
   * The reservation did its job and was spent.
   *
   * Such a claim accrues nothing, because it is collecting again from zero for
   * the next occurrence. Without this flag it is indistinguishable from a claim
   * that is simply not due yet, and a closed month cannot be read back: every
   * reservation that worked has erased itself.
   */
  settledThisMonth?: boolean;
};

export type SettledClaim = ReservationClaim & {
  /** What should already be held for this claim by now. */
  accrued: number;
  /**
   * What this claim holds. Always equals `accrued`.
   *
   * A reservation is a promise about a bill that has not arrived. It is not
   * reduced because the month's allowance was overspent - that would move the
   * problem somewhere nobody is looking. When the balance cannot cover
   * everything, the category reports it once, in `spare`.
   */
  reserved: number;
  /** Always 0. Kept so callers do not have to change. A claim is never short. */
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
   *
   * This falls as the month's allowance is spent. It is what is **left**, not
   * what the month started with. For that, read `allowanceTotal`.
   */
  allowance: number;
  /**
   * What the allowance templates ask for in a month, before any of it is spent.
   * The sum of `allowances[].amount`.
   *
   * `allowance` alone cannot tell a fully spent allowance from a category that
   * has none, and cannot say how much of the month's budget is gone. Both
   * numbers are needed: this one is the size of the allowance, `allowance` is
   * what remains of it.
   */
  allowanceTotal: number;
  /**
   * `balance - reserved - allowance`. More than the future costs and the
   * allowances need.
   *
   * **Negative means overspent.** Claims keep their full accrual and the
   * allowance takes what is left, so a month spent past its allowance shows the
   * deficit here rather than quietly shrinking a reservation. It is a number the
   * user can see and choose how to cover.
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

/**
 * Settle a category's balance against its claims.
 *
 * **Claims hold their full accrual, whatever the balance.** The allowance takes
 * what is left of the balance, and anything still missing lands in `spare` as a
 * negative.
 *
 * That order is the point. An allowance is this month's money and is meant to be
 * spent; a reservation is a promise about a bill that has not arrived. Capping
 * reservations at the balance meant an overspent allowance quietly reduced them,
 * in reverse due-date order, with nothing said - 22.42 of extra dinners became a
 * hole in a birthday fund. Now the category reports the deficit once, in one
 * place, and the user decides where to cover it from.
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
    shortfall: 0,
    onTrack: true,
  }));

  // Allowances get the money that the future costs do not need. As you spend
  // the month's allowance, the balance falls and this value falls with it. It
  // shows what is left of the allowance, not the amount it started at.
  const allowanceTotal = allowances.reduce((sum, a) => sum + a.amount, 0);
  const allowance = Math.min(
    Math.max(0, balance - reserved),
    Math.max(0, allowanceTotal),
  );
  // `balance = reserved + allowance + spare` always holds. When the balance
  // cannot cover the claims and the allowance, this goes negative.
  const spare = balance - reserved - allowance;
  const shortfall = Math.max(0, -spare);

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
    allowanceTotal: Math.round(allowanceTotal),
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
