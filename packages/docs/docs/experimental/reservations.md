# Reservations

<ExperimentalFeatureWarning />

A category balance can look like money you can spend, when part of it is owed to
a future cost. Reservations divide the balance. The number you read before you
spend is then the money you can spend.

Reservations come from the [goal templates](./goal-templates.md) that are
already in a category. You do not set up anything, and Actual stores nothing.

## The three parts

Actual divides a category balance into these parts:

| Part          | Meaning                                           |
| ------------- | ------------------------------------------------- |
| **Reserved**  | Owed to a future cost. Do not spend it yet.       |
| **Allowance** | For you to spend this month. That is its purpose. |
| **Spare**     | Nothing claims this money.                        |

Reserved and Allowance are both money with a job. Together they are
**Committed**. Spare is the money that is left.

A `#template schedule` line makes a **reservation**. This is money that builds
up for a bill that has not arrived. A `#template 1000 [groceries]` line makes an
**allowance**. This is money for you to spend this month.

A repeating **By** template also makes a reservation. Use it for a cost that has
no bill, such as Christmas:

```
#template 750 by 2026-12 repeat every year [christmas]
```

The two types end their cycle in different ways. A bill reservation starts again
when the payment posts. An occasion reservation starts again when the **date
passes**, because Christmas comes whether or not you spent the money. Its target
month then moves forward by itself. A By template that does not repeat has no
cycle, so it is not a reservation.

## Where to see it

Actual removes the reserved part from the **Balance** column. The number you
read before you spend is the money you can spend. Hold the pointer over it to
see the parts:

![The balance breakdown on hover](/img/reservations/balance-hover.png)

Mobile has no pointer, so the same breakdown is in the balance menu. Tap the
balance:

![The balance breakdown on mobile](/img/reservations/mobile-balance-menu.png)

The panel appears only when something claims the balance. A category with no
templates shows nothing more.

## Why an allowance is not a reservation

You should not treat either one as spare, so it is easy to count them together.
But they answer different questions. If you count them together, you get the
wrong answer to both.

A **reservation** is money you must not spend yet. The bill has not arrived. If
you spend the money, you cannot pay the bill.

An **allowance** is money you should spend this month, on the thing it is named
for. If you do not spend it, you did not save money. You did not buy a month of
groceries.

Look at a category with three monthly allowances:

```
#template 1000 [groceries]
#template 150 [healthcare]
#template 35 [dog food]
```

It is the 3rd of the month. You have spent nothing. Every schedule in the
category is paid, so nothing is reserved. If you count the allowance as spare,
you get this:

| Part     | Amount   |
| -------- | -------- |
| Reserved | 0.00     |
| Spare    | 1,185.00 |

That reads as 1,185.00 that nobody uses, and the category shows as **Ahead**. It
looks like money to move somewhere else. It is the grocery budget.

If you keep the two apart, you get this:

| Part      | Amount   |
| --------- | -------- |
| Reserved  | 0.00     |
| Allowance | 1,185.00 |
| Spare     | 0.00     |

The allowance figure shows what is left of the allowance, not the amount it
started at. Buy 400.00 of groceries and it falls to 785.00, because the balance
it measures against also falls. It reaches zero when you have spent the month's
allowances, which is the correct result.

## Moving money out

Actual limits a transfer out of a category to its Balance, which is the figure
with the reservations already removed. You then cannot move money that is
building up for a bill by mistake.

This limit applies to **Transfer**. It does not apply to **Cover**. Cover moves
money into a category that has overspent, and a reservation is not a reason to
stop that.

:::note
The limit stops a mistake. It does not stop you if you want the money. You can
still get it by changing the budgeted amount, from the mobile budget, or through
the API. Treat it as a guard, not as a lock.
:::

## How much is reserved

Each claim collects the same amount in each period. A $ 1,053 bill that is due
in six months holds $ 175.50 after one month, and $ 351 after two months. After
you pay the bill, the schedule moves forward and the claim starts again at zero.

If the balance cannot pay for everything, Actual fills the claims in due-date
order. The bill that is due first gets its money first.

## Through the API

`getReservations` returns the same values for a month. A script can then report
on them, and you do not have to read the budget yourself:

```js
const rows = await api.getReservations('2026-09');
// [{ categoryId, categoryName, balance, reserved, allowance,
//    committed, spare, accrued, shortfall, target, status,
//    claims: [...], allowances: [...] }]
```

All amounts are whole cents. Actual calculates the values on each call and does
not store them. See the [API reference](../api/reference.md#getreservations).

## Status

| Status        | Meaning                                              |
| ------------- | ---------------------------------------------------- |
| **On pace**   | Each claim holds the correct amount for today.       |
| **Shortfall** | The balance is less than the amount you should hold. |
| **Ahead**     | You hold more than you owe up to now.                |
| **Funded**    | Every future cost has all of its money.              |

A category with no templates has no status, because there is nothing to measure.

:::note
Reservations tell you what a category owes. They do not change the budgeted
amount. The templates set that amount. If a category always shows a shortfall,
see the [Fixed Flag](./goal-templates.md#fixed-flag).
:::
