# Reservations

<ExperimentalFeatureWarning />

A category that saves for a future bill holds money you must not spend yet.
Without reservations, that money looks the same as money you can spend.
Reservations divide the category balance into a **reserved** part, which
belongs to a future cost, and a **spare** part, which nothing claims.

Reservations come from the [budget templates](./goal-templates.md) that are
already in a category. You do not set anything up. Actual stores no
reservations. It calculates them again each time the budget changes. The app
shows reservations only when the **Goal templates** experimental feature is on,
and on desktop only in the envelope budget.

## Which Templates Reserve Money

Each of these template lines makes one **claim** on the category balance:

- A `#template schedule` line claims money for a bill that has not arrived.
- A **By** template that repeats claims money for a cost that has no bill, such
  as Christmas:

  ```
  #template 750 by 2026-12 repeat every year [christmas]
  ```

Other lines make no claim. A `#template 1000 [groceries]` line budgets the
category each month, and the `[groceries]` label is a name only. That money is
spare until you spend it. A By template that does not repeat makes no claim
either, because it has no cycle. After its month passes, there is no amount
that you should hold.

A claim takes its name from the schedule, or from the label of the By template.
A By template without a label takes the name of the category.

Actual reads the template lines that it stored the last time you applied budget
templates. After you change a template note, apply the templates again to
update the reservations.

## How Much a Claim Holds

A claim collects the same amount each month, from the start of its cycle to the
month the cost is due. That amount is the cost divided by the number of months
in the cycle. For example, a $ 1,053 bill that repeats every six months holds
$ 175.50 one month after you pay it, $ 351 two months after, and the full
$ 1,053 in the month it is due.

The two kinds of claim start a new cycle at different times:

- A bill claim starts again when you pay the bill. Actual counts a payment when
  a transaction in that month is linked to the schedule. The claim then holds
  $ 0 for the next due date. For the rest of that month, the breakdown lists
  the bill as **spent**, with the bill amount. That amount is not part of
  Reserved.
- An occasion claim, from a repeating By template, starts again when its month
  ends. Christmas comes whether or not you spent the money. Actual then moves
  the target to the next year by itself.

If a bill posts and no transaction is linked to the schedule, the claim does
not show as spent. It holds the full amount until the month ends, and then it
moves to the next due date from the schedule's calendar.

A claim always holds its full amount, even when the balance is too small. If
the balance cannot pay for every claim, the breakdown shows the difference as
**Overspent** in place of Spare.

## What the Budget Shows

Actual takes the reserved part out of the **Balance** column, so the number you
read before you spend is the money you can spend. On desktop, the balance of
each category group also leaves out the reserved part.

To see the parts, hold the pointer over a category's balance. The breakdown
shows **Reserved** with each claim under it, a line, and then **Spare**. A
status line comes last.

![The balance breakdown on hover](/img/reservations/balance-hover.png)

On mobile, tap the balance. The balance menu shows the same breakdown.

![The balance breakdown on mobile](/img/reservations/mobile-balance-menu.png)

The breakdown appears only for a category that has at least one claim.

The status line compares the balance with the claims:

| Status               | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| **Shortfall of $ X** | The balance is $ X less than the claims hold.                                 |
| **On pace**          | The balance is equal to what the claims hold. Nothing is spare.               |
| **Ahead by $ X**     | The balance is $ X more than the claims hold, but less than their full costs. |
| **Fully funded**     | The balance pays for the full cost of every claim.                            |

Reservations do not change the budgeted amount. The templates set that amount.
If a category always shows a shortfall, see the
[Fixed Flag](./goal-templates.md#fixed-flag).

## Why Transfers Are Limited

**Transfer** cannot move more out of a category than its Balance, which is the
amount with the reserved part already taken out. This stops you from moving
money that is saved for a bill by mistake. The limit applies on desktop and on
mobile.

**Cover** has no such limit. It can take reserved money from another category
to cover an overspent category. Money saved for a later bill is not a reason to
leave a category overspent today.

:::note
The limit stops a mistake. It does not lock the money. You can still move it
when you change a budgeted amount, or through the API.
:::

## Read Reservations From a Script

The API method [`getReservations`](../api/reference.md#getreservations) returns
the same values for a month. The CLI command
[`actual reservations`](../api/cli.md#reservations) prints them.
