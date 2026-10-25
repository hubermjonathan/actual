# Reservations reference

<ExperimentalFeatureWarning />

The template syntax, CLI command, and API method that this fork adds for
[Reservations](./reservations.md). The rest of the template syntax is in
[Budget templates](./goal-templates.md).

## Labels

A label in square brackets at the end of a simple, Total, or By template names
the line. The label does not change the budgeted amount.

| Syntax                       | Budgeted Amount |
| ---------------------------- | :-------------: |
| `#template 1000 [groceries]` |     $ 1000      |

On a repeating By template, the label names the claim in
[Reservations](./reservations.md).

## Total template

A Total template makes the budgeted amount of the category equal to a total. It
budgets the total less the amount that the other template lines in the category
budget.

| Syntax                             |             Budgeted Amount              |
| ---------------------------------- | :--------------------------------------: |
| `#template total 1000 [fun money]` | $ 1000, less what the other lines budget |

```
#template total 1000 [fun money]
#template schedule Streaming
#template schedule Phone Case
```

If the two schedules budget $ 22.11 and $ 21.57, the total line budgets
$ 956.32, and the category gets $ 1000.

- The total line runs after the other template lines in the category, whatever
  its priority. A remainder line runs after the total line, so the total does
  not include it.
- If the other lines budget more than the total, the total line budgets $ 0,
  and Actual shows a warning when you apply templates. The other lines keep
  their amounts.
- A Total template does not read the category balance. `#template up to 1000`
  fills the balance up to $ 1000 instead.
- The Budget Automations editor cannot edit a Total template. Edit it in the
  category note.

## Repeating By templates

When every By template in a category repeats, each one budgets the same amount
each month: its amount divided by the number of months in its cycle. For
`#template 500 by 2025-03 repeat every year`, that is $ 41.67. If the balance at
the start of the month is less than the templates should hold by then, Actual
adds the difference in that month. If one By template in the category does not
repeat, all By templates in the category use the upstream calculation.

A repeating By template makes a claim in [Reservations](./reservations.md):

```
#template 750 by 2026-12 repeat every year [christmas]
```

A By template that does not repeat makes no claim.

## Fixed flag

By default, a Schedule template reads the category balance, so the amount it
budgets changes from month to month. The `[fixed]` flag budgets the same amount
each month: the schedule amount divided by the number of months between
payments.

| Syntax                             | Budgeted Amount |                     Note                      |
| ---------------------------------- | :-------------: | :-------------------------------------------: |
| `#template schedule Taxes`         |     varies      | Depends on the balance and on other schedules |
| `#template schedule Taxes [fixed]` |      $ 100      |    A $ 1,200 yearly schedule, every month     |

- A line can have the `[fixed]` flag or an adjustment, but not both.
- The flag has no effect in a tracking budget, on a `full` schedule, or on a
  schedule that repeats every month or more often.
- A fixed schedule continues to budget its amount after it has all of its
  money.

By default, Actual treats the schedules in a category as one shared pot. It
takes them in due-date order, counts the balance against the full amount of
each one, and divides each missing amount across the months until its due date.
A category with bills months apart seldom holds all of their money at once, so
the amount changes as you pay bills. Actual keeps a fixed schedule out of the
pot: it budgets the schedule's monthly amount, and it takes out of the pot the
money that the schedule held at the start of the month, rounded to the cent.

## Deleting a category

When you delete a category, Actual moves its transactions, its budget, and its
rules to the category you choose. It does not move the template lines. Copy
them into the note of the new category first. If two `#template` lines in a
category name the same schedule, Actual counts that schedule twice.

## CLI: `actual reservations`

```bash
# Balance, reserved, spare, and status for each category
actual reservations list 2026-09

# One category only (also works with claims)
actual reservations list 2026-09 --category <id>

# One row for each claim, with its target and the amount it holds now
actual reservations claims 2026-09
```

In `table` and `csv` format, `list` shows one row for each category, without
the claims. In `json` format, `list` returns the full `getReservations` result.

## API: `getReservations`

```ts
getReservations(month: string, options?: { categoryId?: string }): Promise<CategoryReservations[]>
```

Returns one `CategoryReservations` for each expense category in `month`, hidden
categories left out. Pass `categoryId` to return only that category. A category
with no claims has `reserved` 0, `spare` equal to `balance`, and `status`
`null`. Actual calculates the values on each call from the templates that it
stored the last time templates were applied, so a note changed with
`updateNote` has no effect until templates are applied again.

`CategoryReservations`:

| Field          | Type                 | Meaning                                                                                                                                                                                  |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categoryId`   | id                   |                                                                                                                                                                                          |
| `categoryName` | string               |                                                                                                                                                                                          |
| `balance`      | amount               | The category balance, with the reserved part included.                                                                                                                                   |
| `reserved`     | amount               | The sum of `reserved` for all claims. The app subtracts it from the balance that it shows.                                                                                               |
| `spare`        | amount               | `balance - reserved`. Negative when the balance is less than `reserved`.                                                                                                                 |
| `shortfall`    | amount               | `reserved - balance` when that is more than 0. Otherwise 0.                                                                                                                              |
| `target`       | amount               | The sum of `target` for all claims.                                                                                                                                                      |
| `status`       | string               | `null` with no claims. Otherwise `behind` when `shortfall` is more than 0, `funded` when `balance` is at least `target`, `ahead` when `spare` is more than 0, and `onPace` when it is 0. |
| `claims`       | `ReservationClaim[]` | Sorted by `nextDate`, then by name.                                                                                                                                                      |

`ReservationClaim`:

| Field              | Type    | Meaning                                                                                                                                                                                               |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`             | string  | The schedule name, or the label of a repeating By template. A By template with no label uses the category name.                                                                                       |
| `target`           | amount  | The schedule amount after adjustments, or the amount of the By template.                                                                                                                              |
| `nextDate`         | date    | The next due date. For a By template, the first day of its target month.                                                                                                                              |
| `monthlyRate`      | number  | What the claim collects each month. Not rounded.                                                                                                                                                      |
| `monthsRemaining`  | integer | Calendar months from `month` to `nextDate`. 0 means the claim is due in `month`.                                                                                                                      |
| `reserved`         | amount  | `target - monthlyRate * monthsRemaining`, limited to 0 through `target` and rounded. A claim holds this amount even when the balance is smaller.                                                      |
| `fixed`            | bool    | `true` when the schedule template has the `[fixed]` flag.                                                                                                                                             |
| `settledThisMonth` | bool    | `true` when the schedule was due in `month` and a transaction in `month` is linked to it, or the schedule has moved past that date. The app then shows it as spent. Always `false` for a By template. |
