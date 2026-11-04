---
"@storyshelf/db-sqlite": patch
---

Fixed: overlapping `transact` calls on the SQLite adapters (node:sqlite, better-sqlite3, bun, D1, Turso) no longer fail with "cannot start a transaction within a transaction". The adapter runs one transaction at a time and queues the rest, so approvals and the queue's acknowledgements under load commit instead of erroring. A transaction that opens another on the same database now fails at once with a clear error instead of hanging.
