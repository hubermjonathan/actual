---
category: Bugfixes
authors: [hubermjonathan]
---

Fix schedule templates with `[fixed]` schedules: the money those schedules should hold at the start of the month is now taken from last month's balance in whole cents, so the template no longer asks for an extra month or a fraction of a cent that cannot be saved
