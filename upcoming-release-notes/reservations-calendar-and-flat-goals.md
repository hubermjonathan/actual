---
category: Bugfixes
authors: [hubermjonathan]
---

Reservations take a claim's due date from the schedule's calendar, so a claim no longer freezes when a payment fails to link, and a bill paid earlier in the month reads as spent. Allowances are gone from reservations: spare is the balance less what claims hold, a category without claims has no status, and `[label]` on a template is a name only. Repeating `by` goals are budgeted at their flat monthly rate
