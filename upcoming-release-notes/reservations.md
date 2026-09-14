---
category: Features
authors: [hubermjonathan]
---

Divide each budget category balance into three parts: the money **reserved** for
known future costs, this month's **allowance**, and the money that is **spare**.
A category that holds a sinking fund no longer reads as if you could spend the
whole balance today.

Actual takes the reserved part out of the Balance column, so the number you read
before you spend is the money you can spend. Hold the pointer over the balance,
or tap it on mobile, to see the parts and the claims behind them. A transfer out
of a category is limited to that reduced balance, so you cannot move money that
is kept for a future cost by mistake.

Reservations come from the goal templates already in a category:

- `#template schedule Rent` reserves for a bill.
- `#template 1000 [groceries]` is an allowance, which is money to spend this
  month. Simple and By templates can both carry a `[label]`.
- `#template 750 by 2026-12 repeat every year [christmas]` reserves for a cost
  with no bill, such as Christmas. The cycle ends when the date passes.
- `#template schedule Taxes [fixed]` budgets the same amount each month, which
  is the schedule amount divided by its interval, instead of changing with the
  category balance.
