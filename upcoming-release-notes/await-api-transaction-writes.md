---
category: Bugfixes
authors: [hubermjonathan]
---

Fix `updateTransaction` and `deleteTransaction` in the API returning before the write had run, so a caller that read the transaction back immediately saw the old value
