# Reservations

<ExperimentalFeatureWarning />

A category's balance can look spendable when part of it is really owed to a
future cost. Reservations split the balance so the number you read before
spending is the money you can actually spend.

They are derived from the [goal templates](./goal-templates.md) already in a
category — there is nothing extra to set up, and nothing is stored.

## The three parts

A category's balance is divided into:

| Part          | Meaning                                                   |
| ------------- | --------------------------------------------------------- |
| **Reserved**  | Owed to a future cost. Should not be spent yet.           |
| **Allowance** | For spending this month. Spendable — that is its purpose. |
| **Spare**     | Neither. Genuinely nothing claiming it.                   |

Reserved and Allowance are both money with a job, so together they are
**Committed**. Spare is what is left.

A `#template schedule` line creates a **reservation**: money building up for a
bill that has not arrived. A `#template 1000 [groceries]` line is an
**allowance**: money meant to be spent this month.

The budget shows a **Committed** column, and the **Balance** column has the
reserved part taken out. Hovering the figure breaks it into Reserved, Allowance
and Spare.

## Why an allowance is not a reservation

Both are money you should not treat as spare, so it is tempting to count them
together. They answer different questions, and counting them together gives the
wrong answer to both.

A **reservation** is money that must _not_ be spent yet. The bill has not
arrived. Spending it means the bill cannot be paid.

An **allowance** is money that _should_ be spent, this month, on the thing it is
named for. Not spending it is not a saving — it is a month of groceries you did
not buy.

Take a category holding three monthly allowances:

```
#template 1000 [groceries]
#template 150 [healthcare]
#template 35 [dog food]
```

It is the 3rd of the month, nothing has been spent yet, and every schedule in
the category is paid up, so nothing is reserved. Counting the allowance as spare
gives:

| Part     | Amount   |
| -------- | -------- |
| Reserved | 0.00     |
| Spare    | 1,185.00 |

which reads as 1,185.00 going unused, and the category shows as **Ahead** —
money to redirect somewhere else. It is the grocery budget.
Separating the two gives:

| Part      | Amount   |
| --------- | -------- |
| Reserved  | 0.00     |
| Allowance | 1,185.00 |
| Spare     | 0.00     |

The allowance figure is what is **left** of the allowance, not what it started
at. Buy 400.00 of groceries and it falls to 785.00, because the balance it is
measured against has fallen too. It reaches zero when the month's allowances
have been spent, which is what is supposed to happen.

## Moving money out

Transfers out of a category are capped at its Balance — the figure with
reservations already taken out — so money building up for a bill cannot be moved
somewhere else by accident.

This limit applies to **Transfer**, not to **Cover**. Cover pulls money _into_ a
category that has overspent, and a reservation is no reason to block that.

:::note
The cap prevents the accident, not a determined raid. The same money is still
reachable by editing the budgeted amount directly, from the mobile budget, or
through the API. Treat it as a guard rail rather than a lock.
:::

## How much is reserved

Each claim accrues evenly across its period. A $ 1,053 bill due in six months
holds $ 175.50 after one month, $ 351 after two, and so on. Once the bill is
paid the schedule rolls forward and the claim starts again from zero.

If the balance cannot cover everything, claims are settled in due-date order —
the soonest bill is funded first.

## Through the API

`getReservations` returns the same figures for a month, so a script can report
on them without reading the budget by hand:

```js
const rows = await api.getReservations('2026-09');
// [{ categoryId, categoryName, balance, reserved, allowance,
//    committed, spare, accrued, shortfall, target, status,
//    claims: [...], allowances: [...] }]
```

Amounts are integer cents, and the figures are derived on each call rather than
stored. See the [API reference](../api/reference.md#getreservations).

## Status

| Status        | Meaning                                              |
| ------------- | ---------------------------------------------------- |
| **On pace**   | Every claim holds what it should by now.             |
| **Shortfall** | The balance is short of what should have been saved. |
| **Ahead**     | More is held than is owed so far.                    |
| **Funded**    | Every future cost is covered in full.                |

A category with no templates has no status — there is nothing to measure.

:::note
Reservations describe what a category owes. They do not change how much is
budgeted; that is decided by the templates themselves. If a category
persistently shows a shortfall, see the
[Fixed Flag](./goal-templates.md#fixed-flag).
:::
