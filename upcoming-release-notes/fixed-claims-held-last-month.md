---
category: Bugfixes
authors: [hubermjonathan]
---

Fix schedule templates in a category whose only sinking schedules are `[fixed]`: the money those schedules already hold is counted as of the end of last month, so the template no longer asks for an extra month or a fraction of a cent that cannot be saved
