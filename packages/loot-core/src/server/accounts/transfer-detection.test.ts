import * as db from '#server/db';

import type { TransferCandidate } from './transfer-detection';
import { detectTransfers, findTransferMatch } from './transfer-detection';

function transaction(
  overrides: Partial<TransferCandidate> & Pick<TransferCandidate, 'id'>,
): TransferCandidate {
  return {
    account: 'checking',
    amount: -10000,
    date: '2026-09-08',
    transfer_id: null,
    starting_balance_flag: false,
    is_parent: false,
    is_child: false,
    ...overrides,
  };
}

describe('findTransferMatch', () => {
  it('matches the opposite side in another account', () => {
    const outflow = transaction({ id: 'out', account: 'checking' });
    const inflow = transaction({ id: 'in', account: 'card', amount: 10000 });

    expect(findTransferMatch(outflow, [inflow])).toBe(inflow);
    expect(findTransferMatch(inflow, [outflow])).toBe(outflow);
  });

  // The two banks post a transfer on different days.
  it.each([
    ['2026-09-05', undefined, true],
    ['2026-09-20', undefined, false],
    ['2026-09-11', 2, false],
  ])(
    'with the other side on %s and a window of %s, matches: %s',
    (date, maxDaysApart, matches) => {
      const outflow = transaction({ id: 'out' });
      const inflow = transaction({
        id: 'in',
        account: 'card',
        amount: 10000,
        date,
      });

      expect(findTransferMatch(outflow, [inflow], { maxDaysApart })).toBe(
        matches ? inflow : null,
      );
    },
  );

  it('does not match a charge and its refund on the same card', () => {
    // On amount and date alone the refund pairs with either purchase.
    const refund = transaction({
      id: 'refund',
      account: 'bilt',
      amount: 1104,
      date: '2026-09-03',
    });
    const ownCharge = transaction({
      id: 'own-charge',
      account: 'bilt',
      amount: -1104,
      date: '2026-08-31',
    });
    const otherCardPurchase = transaction({
      id: 'other-purchase',
      account: 'venture-x',
      amount: -1104,
      date: '2026-09-02',
    });

    expect(
      findTransferMatch(refund, [ownCharge, otherCardPurchase]),
    ).toBeNull();
  });

  it('does not match when the counterpart has its own refund', () => {
    const outflow = transaction({ id: 'out', amount: -1104 });
    const inflow = transaction({
      id: 'in',
      account: 'card',
      amount: 1104,
      date: '2026-09-09',
    });
    const counterpartsRefund = transaction({
      id: 'card-refund',
      account: 'card',
      amount: -1104,
      date: '2026-09-10',
    });

    expect(findTransferMatch(outflow, [inflow, counterpartsRefund])).toBeNull();
  });

  it('refuses two equally good candidates rather than guessing', () => {
    const outflow = transaction({ id: 'out' });
    const first = transaction({ id: 'a', account: 'card-a', amount: 10000 });
    const second = transaction({ id: 'b', account: 'card-b', amount: 10000 });

    expect(findTransferMatch(outflow, [first, second])).toBeNull();
  });

  it.each([
    { transfer_id: 'x' },
    { starting_balance_flag: true },
    { is_parent: true },
    { is_child: true },
  ])('ignores a transaction with %o on either side', fields => {
    const outflow = transaction({ id: 'out' });
    const inflow = transaction({ id: 'in', account: 'card', amount: 10000 });

    expect(findTransferMatch(outflow, [{ ...inflow, ...fields }])).toBeNull();
    expect(findTransferMatch({ ...outflow, ...fields }, [inflow])).toBeNull();
  });

  it('never matches a zero amount or the transaction itself', () => {
    const zero = transaction({ id: 'out', amount: 0 });
    const outflow = transaction({ id: 'out' });

    expect(
      findTransferMatch(zero, [{ ...zero, id: 'in', account: 'card' }]),
    ).toBeNull();
    expect(findTransferMatch(outflow, [outflow])).toBeNull();
  });
});

describe('detectTransfers', () => {
  beforeEach(async () => {
    await global.emptyDatabase()();
  });

  async function account(
    id: string,
    { offbudget = 0, transferPayee = true } = {},
  ) {
    await db.insertAccount({ id, name: id, offbudget });
    if (transferPayee) {
      await db.insertPayee({
        id: `transfer-${id}`,
        name: '',
        transfer_acct: id,
      });
    }
    return id;
  }

  async function row(
    id: string,
    acct: string,
    amount: number,
    date = '2026-09-08',
    fields: Record<string, unknown> = {},
  ) {
    await db.insertTransaction({ id, account: acct, amount, date, ...fields });
    return id;
  }

  const read = (id: string) =>
    db.first<db.DbViewTransaction>(
      'SELECT * FROM v_transactions WHERE id = ?',
      [id],
    );

  it('links both sides, names the transfer payees and clears the categories', async () => {
    await db.insertCategoryGroup({ id: 'group1', name: 'group1' });
    const category = await db.insertCategory({
      name: 'misc',
      cat_group: 'group1',
    });
    await account('checking');
    await account('card');
    await row('out', 'checking', -475619, '2026-09-08', { category });
    await row('in', 'card', 475619, '2026-09-05', { category });

    await expect(detectTransfers(['out'])).resolves.toEqual([['out', 'in']]);

    const out = await read('out');
    const inflow = await read('in');
    expect(out).toMatchObject({
      transfer_id: 'in',
      payee: 'transfer-card',
      category: null,
    });
    expect(inflow).toMatchObject({
      transfer_id: 'out',
      payee: 'transfer-checking',
      category: null,
    });
  });

  it('ignores a counterpart in an off-budget account', async () => {
    await account('checking');
    await account('brokerage', { offbudget: 1 });
    await row('out', 'checking', -50000);
    await row('in', 'brokerage', 50000);

    await expect(detectTransfers(['out'])).resolves.toEqual([]);
    expect((await read('out'))?.transfer_id).toBeNull();
  });

  it('leaves both rows alone when an account has no transfer payee', async () => {
    await account('checking');
    await account('card', { transferPayee: false });
    await row('out', 'checking', -50000);
    await row('in', 'card', 50000);

    await expect(detectTransfers(['out'])).resolves.toEqual([]);
    expect((await read('out'))?.transfer_id).toBeNull();
    expect((await read('in'))?.transfer_id).toBeNull();
  });

  it('links each pair once when a batch holds several', async () => {
    await account('checking');
    await account('card');
    await account('loan');
    await row('out1', 'checking', -100, '2026-09-01');
    await row('in1', 'card', 100, '2026-09-01');
    await row('out2', 'checking', -200, '2026-09-20');
    await row('in2', 'loan', 200, '2026-09-20');

    // a pair is reported in the order the batch reached it, so compare the
    // pairs themselves rather than which half came first
    const linked = await detectTransfers(['out1', 'in1', 'out2']);
    expect(linked.map(pair => [...pair].sort())).toEqual([
      ['in1', 'out1'],
      ['in2', 'out2'],
    ]);
  });
});
