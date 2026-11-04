---
"@storyshelf/core": patch
"@storyshelf/db-postgres": patch
---

A database adapter can now declare `metadata.transactions: "sequential"` when its `transact` cannot roll back. The Neon HTTP adapter does, so the queue no longer treats its emulated transaction as atomic when it ends a single-flight job and hands over its key (it takes the ordered two-step path), and booting with `testing` on such a database logs a warning.
