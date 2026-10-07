import * as d from 'date-fns';

import * as monthUtils from '#shared/months';
import { getNextDate } from '#shared/schedules';
import { amountToInteger } from '#shared/util';
import type { RecurConfig } from '#types/models';
import type { ByTemplate } from '#types/models/templates';

export type ReservationClaim = {
  name: string;
  target: number;
  nextDate: string;
  monthlyRate: number;
  monthsRemaining: number;
  fixed: boolean;
  settledThisMonth: boolean;
};

export type SettledClaim = ReservationClaim & {
  accrued: number;
  reserved: number;
};

export type ReservationStatus = 'behind' | 'onPace' | 'ahead' | 'funded';

export type CategoryReservations = {
  balance: number;
  reserved: number;
  spare: number;
  accrued: number;
  shortfall: number;
  target: number;
  status: ReservationStatus | null;
  claims: SettledClaim[];
};

// Not rounded per claim: the budget engine adds exact rates and rounds the
// total once, so rounding first would put the category a cent off.
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

export function settleReservations(
  balance: number,
  claims: ReservationClaim[],
): CategoryReservations {
  const ordered = [...claims].sort((a, b) => {
    const byDate = a.nextDate.localeCompare(b.nextDate);
    return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
  });

  const exact = ordered.map(claim => {
    const accrued = accruedToDate(claim);
    return { claim, accrued, reserved: accrued };
  });

  const reserved = Math.round(exact.reduce((sum, c) => sum + c.reserved, 0));
  const accrued = Math.round(exact.reduce((sum, c) => sum + c.accrued, 0));
  const target = exact.reduce((sum, c) => sum + c.claim.target, 0);

  const settled: SettledClaim[] = exact.map(c => ({
    ...c.claim,
    accrued: Math.round(c.accrued),
    reserved: Math.round(c.reserved),
  }));

  const spare = balance - reserved;
  const shortfall = Math.max(0, -spare);

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

// Advancing a schedule rewrites its rule's `start`, and a recurrence has no
// occurrence before its start, so step the start back by whole intervals.
// Moving the start of an `after_n_occurrences` schedule would move its end.
export function getOccurrenceOnOrAfter(
  dateCond: { value: RecurConfig | string } | null,
  from: string,
): string | null {
  const value = dateCond?.value;
  if (
    !value ||
    typeof value !== 'object' ||
    !value.frequency ||
    !value.start ||
    value.endMode === 'after_n_occurrences'
  ) {
    return getNextDate(dateCond, monthUtils.parseDate(from));
  }

  // Whole years keep the start's day: one month back from the 31st is the 30th.
  const interval = value.interval || 1;
  const original = monthUtils.parseDate(value.start);
  const stepBack = (steps: number): Date => {
    switch (value.frequency) {
      case 'yearly':
      case 'monthly':
        return d.subMonths(original, 12 * interval * steps);
      case 'weekly':
        return d.subDays(original, 7 * interval * steps);
      default:
        return d.subDays(original, interval * steps);
    }
  };

  let start = original;
  const target = monthUtils.parseDate(from);
  for (let steps = 1; steps <= 1000 && start > target; steps++) {
    start = stepBack(steps);
  }

  return getNextDate(
    { ...dateCond, value: { ...value, start: monthUtils.dayFromDate(start) } },
    target,
  );
}
