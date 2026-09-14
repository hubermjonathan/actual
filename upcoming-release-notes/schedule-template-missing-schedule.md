---
category: Bugfix
authors: [hubermjonathan]
---

Keep budget templates working when a category note names a schedule that no
longer exists. Deleting a schedule leaves its `#template schedule <name>` line
behind. The lookup then found no row, and the code read the fields off it
anyway, so the run ended with `Cannot destructure property 'id' of
'(intermediate value)' as it is null` and no category got a budget.

The missing schedule now becomes a template error, as a schedule in the past
already does, and the other templates still run.
