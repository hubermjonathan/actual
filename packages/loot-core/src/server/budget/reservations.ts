// A reservation is a named claim inside a category for a known future cost.
//
// The problem it solves: a category's balance reads as spendable when part of
// it is really owed to an irregular cost that has not arrived yet. Splitting
// the balance into `reserved` and `available` makes the number you read before
// spending the money you can actually spend.
//
// Everything here is DERIVED on read, never stored. A stored figure would drift
// the moment a transaction posts, an amount changes, or a budget cell is edited
// by hand, and there is no reliable place to invalidate it. Deriving from each
// claim's next due date also makes draw-down automatic: when a bill posts and
// the schedule rolls forward, that claim's accrual restarts on its own.

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

export type CategoryReservations = {
  balance: number;
  /** Portion of the balance spoken for by claims. */
  reserved: number;
  /** `balance - reserved` — what is genuinely free to spend. */
  available: number;
  /** What should be held across all claims, ignoring whether it is there. */
  accrued: number;
  /** `accrued - reserved` — how far behind the category is in total. */
  shortfall: number;
  claims: SettledClaim[];
};

/**
 * How much of `target` should already be set aside.
 *
 * Derived as `target - monthlyRate * monthsRemaining`: whatever is still to be
 * saved is the rate times the months left, so everything else is owed already.
 * Expressing it this way reuses the engine's own contribution rate rather than
 * reimplementing period arithmetic, so the two cannot disagree.
 *
 * Rounded to whole cents. `monthlyRate` is a division, so leaving it unrounded
 * lets a float reach the spreadsheet, which rejects non-integers.
 */
export function accruedToDate(claim: ReservationClaim): number {
  const remaining = claim.monthlyRate * claim.monthsRemaining;
  return Math.round(
    Math.min(claim.target, Math.max(0, claim.target - remaining)),
  );
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
): CategoryReservations {
  const ordered = [...claims].sort((a, b) => {
    const byDate = a.nextDate.localeCompare(b.nextDate);
    return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
  });

  let unallocated = Math.max(0, balance);
  const settled: SettledClaim[] = ordered.map(claim => {
    const accrued = accruedToDate(claim);
    const reserved = Math.min(unallocated, accrued);
    unallocated -= reserved;
    const shortfall = accrued - reserved;
    return { ...claim, accrued, reserved, shortfall, onTrack: shortfall === 0 };
  });

  const reserved = settled.reduce((sum, c) => sum + c.reserved, 0);
  const accrued = settled.reduce((sum, c) => sum + c.accrued, 0);

  return {
    balance,
    reserved,
    available: balance - reserved,
    accrued,
    shortfall: accrued - reserved,
    claims: settled,
  };
}
