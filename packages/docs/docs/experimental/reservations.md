# Reservations

<ExperimentalFeatureWarning />

A category balance can look like money you can spend, when part of it is owed to
a future cost. Reservations divide the balance. The number you read before you
spend is then the money you can spend.

Reservations come from the [goal templates](./goal-templates.md) that are
already in a category. You do not set up anything, and Actual stores nothing.

## The two parts

Actual divides a category balance into these parts:

| Part         | Meaning                                     |
| ------------ | ------------------------------------------- |
| **Reserved** | Owed to a future cost. Do not spend it yet. |
| **Spare**    | Nothing claims this money.                  |

A `#template schedule` line makes a **reservation**. This is money that builds
up for a bill that has not arrived. A `#template 1000 [groceries]` line makes no
reservation: it budgets the category each month, and the label is a name only.
That money is spare until you spend it.

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
in six months holds $ 175.50 after one month, and $ 351 after two months.

The due date comes from the schedule's calendar. After you pay the bill, the
claim starts again at zero for the next date, and in the month you paid it the
breakdown shows the bill as **spent**. A payment counts when a transaction is
linked to the schedule. If the bill posts and nothing links, the claim does not
read as spent, but it still moves on to the next date.

A claim always holds its full amount. If the balance cannot cover every claim,
the difference shows once, as a negative spare. The breakdown calls it
**Overspent**.

## Through the API

`getReservations` returns the same values for a month. A script can then report
on them, and you do not have to read the budget yourself:

```js
const rows = await api.getReservations('2026-09');
// [{ categoryId, categoryName, balance, reserved, spare, accrued,
//    shortfall, target, status, claims: [...] }]
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

A category with no claims has no status, because there is nothing to measure.

:::note
Reservations tell you what a category owes. They do not change the budgeted
amount. The templates set that amount. If a category always shows a shortfall,
see the [Fixed Flag](./goal-templates.md#fixed-flag).
:::
