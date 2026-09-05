# Reservations

<ExperimentalFeatureWarning />

A category's balance can look spendable when part of it is really owed to a
future cost. Reservations split the balance so the number you read before
spending is the money you can actually spend.

They are derived from the [goal templates](./goal-templates.md) already in a
category — there is nothing extra to set up, and nothing is stored.

## The three parts

A category's balance is divided into:

| Part          | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| **Reserved**  | Owed to a future cost. Should not be spent yet.                 |
| **Committed** | An allowance for this month. Spendable — that is its purpose.   |
| **Available** | Neither. Genuinely spare.                                       |

A `#template schedule` line creates a **reservation**: money building up for a
bill that has not arrived. A `#template 1000 [groceries]` line is an
**allowance**: money meant to be spent this month.

The budget shows a **Reserved** column, and the **Balance** column has it taken
out. Transfers out of a category are capped at that balance, so a reservation
cannot be moved by accident.

## How much is reserved

Each claim accrues evenly across its period. A $ 1,053 bill due in six months
holds $ 175.50 after one month, $ 351 after two, and so on. Once the bill is
paid the schedule rolls forward and the claim starts again from zero.

If the balance cannot cover everything, claims are settled in due-date order —
the soonest bill is funded first.

## Status

| Status      | Meaning                                                |
| ----------- | ------------------------------------------------------ |
| **On pace** | Every claim holds what it should by now.                |
| **Behind**  | The balance is short of what should have been saved.    |
| **Ahead**   | More is held than is owed so far.                       |
| **Funded**  | Every future cost is covered in full.                   |

A category with no templates has no status — there is nothing to measure.

:::note
Reservations describe what a category owes. They do not change how much is
budgeted; that is decided by the templates themselves. If a category is
persistently behind, see the [Fixed Flag](./goal-templates.md#fixed-flag).
:::
