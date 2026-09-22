import * as db from '#server/db';
import * as monthUtils from '#shared/months';

/**
 * Every account in a fully bank-synced budget imports its own side of a
 * transfer, so a payment between two accounts arrives as two unrelated
 * transactions. Nothing in Actual links two transactions that already exist:
 * `addTransfer` creates a third one, and `mergeTransactions` refuses to touch
 * two different accounts.
 *
 * This links them, which keeps both `imported_id`s.
 *
 * Matching on amount and date alone is not safe, so the rules below are
 * deliberately strict: a single unambiguous candidate, and nothing that could be
 * explained inside one account instead.
 */

export type TransferCandidate = {
  id: string;
  account: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  transfer_id?: string | null;
  starting_balance_flag?: boolean | number | null;
  is_parent?: boolean | number | null;
  is_child?: boolean | number | null;
};

export const DEFAULT_MAX_DAYS_APART = 5;

function isEligible(transaction: TransferCandidate) {
  return (
    !transaction.transfer_id &&
    !transaction.starting_balance_flag &&
    !transaction.is_parent &&
    !transaction.is_child &&
    transaction.amount !== 0
  );
}

function withinWindow(
  a: TransferCandidate,
  b: TransferCandidate,
  maxDaysApart: number,
) {
  return (
    Math.abs(monthUtils.differenceInCalendarDays(a.date, b.date)) <=
    maxDaysApart
  );
}

/**
 * The other half of `transaction`, or null when there is any doubt.
 *
 * `nearby` must hold every candidate transaction in the date window except
 * `transaction` itself, including ones in `transaction`'s own account -- those
 * are what rule 2 needs. The caller decides which accounts are eligible at all;
 * this only reasons about the rows it is handed.
 *
 * 1. exactly one candidate in another account with the opposite amount. Two
 *    equally good candidates are a coin flip, so we take neither.
 * 2. neither side may have an opposite-amount row in its OWN account. A card
 *    that charges 11.04 and refunds it looks exactly like a transfer otherwise,
 *    and that refund is not one.
 */
export function findTransferMatch(
  transaction: TransferCandidate,
  nearby: TransferCandidate[],
  { maxDaysApart = DEFAULT_MAX_DAYS_APART }: { maxDaysApart?: number } = {},
): TransferCandidate | null {
  if (!isEligible(transaction)) {
    return null;
  }

  const inWindow = nearby.filter(
    candidate =>
      candidate.id !== transaction.id &&
      isEligible(candidate) &&
      withinWindow(transaction, candidate, maxDaysApart),
  );

  const opposite = -transaction.amount;

  // rule 2, this side
  if (
    inWindow.some(
      candidate =>
        candidate.account === transaction.account &&
        candidate.amount === opposite,
    )
  ) {
    return null;
  }

  // rule 1
  const candidates = inWindow.filter(
    candidate =>
      candidate.account !== transaction.account &&
      candidate.amount === opposite,
  );
  if (candidates.length !== 1) {
    return null;
  }
  const match = candidates[0];

  // rule 2, the other side
  if (
    inWindow.some(
      candidate =>
        candidate.account === match.account &&
        candidate.amount === transaction.amount &&
        withinWindow(match, candidate, maxDaysApart),
    )
  ) {
    return null;
  }

  return match;
}

async function getTransferPayees(accounts: string[]) {
  if (accounts.length === 0) {
    return new Map<string, string>();
  }
  const rows = await db.all<Pick<db.DbPayee, 'id' | 'transfer_acct'>>(
    `SELECT id, transfer_acct FROM payees
     WHERE tombstone = 0 AND transfer_acct IN (${accounts.map(() => '?').join(',')})`,
    accounts,
  );
  return new Map(rows.map(row => [row.transfer_acct, row.id]));
}

// Only on-budget accounts: a transfer to an off-budget account keeps its
// category, so linking one silently would change what the budget reports.
const CANDIDATE_SELECT = `SELECT t.id, t.account, t.amount, t.date, t.transfer_id,
            t.starting_balance_flag, t.is_parent, t.is_child
     FROM v_transactions t
     JOIN accounts a ON a.id = t.account
     WHERE a.tombstone = 0 AND a.offbudget = 0`;

const toCandidate = (row: db.DbViewTransaction): TransferCandidate => ({
  ...row,
  date: db.fromDateRepr(row.date),
});

async function getCandidates(
  from: string,
  to: string,
): Promise<TransferCandidate[]> {
  const rows = await db.all<db.DbViewTransaction>(
    `${CANDIDATE_SELECT}
       AND t.date >= ? AND t.date <= ?`,
    [db.toDateRepr(from), db.toDateRepr(to)],
  );
  return rows.map(toCandidate);
}

async function getCandidatesByIds(ids: string[]): Promise<TransferCandidate[]> {
  const rows = await db.all<db.DbViewTransaction>(
    `${CANDIDATE_SELECT}
       AND t.id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  return rows.map(toCandidate);
}

/**
 * Link whichever of `transactionIds` has an unambiguous counterpart.
 *
 * Both sides get the other account's transfer payee and lose their category:
 * every account considered here is on budget, so a transfer between two of them
 * budgets nothing, the same conclusion `clearCategory` reaches.
 *
 * Returns the pairs it linked.
 */
export async function detectTransfers(
  transactionIds: string[],
  { maxDaysApart = DEFAULT_MAX_DAYS_APART }: { maxDaysApart?: number } = {},
): Promise<Array<[string, string]>> {
  if (transactionIds.length === 0) {
    return [];
  }

  // Sort so a batch holding both halves of the same pair always links it the
  // same way round, whatever order the rows came back in.
  const subjects = (await getCandidatesByIds(transactionIds)).sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
  );
  if (subjects.length === 0) {
    return [];
  }

  const nearby = await getCandidates(
    monthUtils.subDays(subjects[0].date, maxDaysApart),
    monthUtils.addDays(subjects[subjects.length - 1].date, maxDaysApart),
  );

  const linked: Array<[string, string]> = [];
  const claimed = new Set<string>();

  for (const transaction of subjects) {
    if (claimed.has(transaction.id)) {
      continue;
    }
    const available = nearby.filter(candidate => !claimed.has(candidate.id));
    const match = findTransferMatch(transaction, available, { maxDaysApart });
    if (!match) {
      continue;
    }

    const payees = await getTransferPayees([
      transaction.account,
      match.account,
    ]);
    const payeeForTransaction = payees.get(match.account);
    const payeeForMatch = payees.get(transaction.account);
    if (!payeeForTransaction || !payeeForMatch) {
      // An account with no transfer payee cannot be named as one side of a
      // transfer, so leave both rows alone rather than half-link them.
      continue;
    }

    await db.updateTransaction({
      id: transaction.id,
      transfer_id: match.id,
      payee: payeeForTransaction,
      category: null,
    });
    await db.updateTransaction({
      id: match.id,
      transfer_id: transaction.id,
      payee: payeeForMatch,
      category: null,
    });

    claimed.add(transaction.id);
    claimed.add(match.id);
    linked.push([transaction.id, match.id]);
  }

  return linked;
}
