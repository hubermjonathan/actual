import * as db from '#server/db';
import * as monthUtils from '#shared/months';
import { validForTransfer } from '#shared/transfer';
import type { TransactionEntity } from '#types/models';

export type TransferCandidate = {
  id: string;
  account: string;
  amount: number;
  date: string;
  transfer_id?: string | null;
  starting_balance_flag?: boolean | number | null;
  is_parent?: boolean | number | null;
  is_child?: boolean | number | null;
};

const MAX_DAYS_APART = 5;

function isEligible(transaction: TransferCandidate) {
  return (
    !transaction.transfer_id &&
    !transaction.starting_balance_flag &&
    !transaction.is_parent &&
    !transaction.is_child &&
    transaction.amount !== 0
  );
}

function withinWindow(a: TransferCandidate, b: TransferCandidate) {
  return (
    Math.abs(monthUtils.differenceInCalendarDays(a.date, b.date)) <=
    MAX_DAYS_APART
  );
}

// A card that charges an amount and refunds it looks exactly like a transfer,
// so a match must be the only candidate, with no opposite amount in either
// side's own account.
export function findTransferMatch(
  transaction: TransferCandidate,
  nearby: TransferCandidate[],
): TransferCandidate | null {
  if (!isEligible(transaction)) {
    return null;
  }

  const inWindow = nearby.filter(
    candidate =>
      candidate.id !== transaction.id &&
      isEligible(candidate) &&
      withinWindow(transaction, candidate),
  );

  const opposite = -transaction.amount;

  if (
    inWindow.some(
      candidate =>
        candidate.account === transaction.account &&
        candidate.amount === opposite,
    )
  ) {
    return null;
  }

  const candidates = inWindow.filter(candidate =>
    validForTransfer(
      transaction as unknown as TransactionEntity,
      candidate as unknown as TransactionEntity,
    ),
  );
  if (candidates.length !== 1) {
    return null;
  }
  const match = candidates[0];

  if (
    inWindow.some(
      candidate =>
        candidate.account === match.account &&
        candidate.amount === transaction.amount &&
        withinWindow(match, candidate),
    )
  ) {
    return null;
  }

  return match;
}

async function getTransferPayees(accounts: string[]) {
  const rows = await db.all<Pick<db.DbPayee, 'id' | 'transfer_acct'>>(
    `SELECT id, transfer_acct FROM payees
     WHERE tombstone = 0 AND transfer_acct IN (${accounts.map(() => '?').join(',')})`,
    accounts,
  );
  return new Map(rows.map(row => [row.transfer_acct, row.id]));
}

// Only on-budget accounts: a transfer to an off-budget account keeps its
// category, so linking one would change what the budget reports.
async function getCandidates(
  where: string,
  params: Array<string | number>,
): Promise<TransferCandidate[]> {
  const rows = await db.all<db.DbViewTransaction>(
    `SELECT t.id, t.account, t.amount, t.date, t.transfer_id,
            t.starting_balance_flag, t.is_parent, t.is_child
     FROM v_transactions t
     JOIN accounts a ON a.id = t.account
     WHERE a.tombstone = 0 AND a.offbudget = 0 AND ${where}`,
    params,
  );
  return rows.map(row => ({ ...row, date: db.fromDateRepr(row.date) }));
}

export async function detectTransfers(
  transactionIds: string[],
): Promise<Array<[string, string]>> {
  if (transactionIds.length === 0) {
    return [];
  }

  const subjects = (
    await getCandidates(
      `t.id IN (${transactionIds.map(() => '?').join(',')})`,
      transactionIds,
    )
  ).sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
  );
  if (subjects.length === 0) {
    return [];
  }

  const nearby = await getCandidates('t.date >= ? AND t.date <= ?', [
    db.toDateRepr(monthUtils.subDays(subjects[0].date, MAX_DAYS_APART)),
    db.toDateRepr(
      monthUtils.addDays(subjects[subjects.length - 1].date, MAX_DAYS_APART),
    ),
  ]);

  const linked: Array<[string, string]> = [];
  const claimed = new Set<string>();

  for (const transaction of subjects) {
    if (claimed.has(transaction.id)) {
      continue;
    }
    const available = nearby.filter(candidate => !claimed.has(candidate.id));
    const match = findTransferMatch(transaction, available);
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
