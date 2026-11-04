---
"@storyshelf/db-sqlite": patch
---

Fix: on the built-in SQLite adapters (`node:sqlite`, better-sqlite3, `bun:sqlite`), a plain statement issued while a transaction was awaiting ran inside that transaction, so a rollback silently undid an unrelated write. Plain statements now wait their turn behind an open transaction, and a plain call on the outer adapter from inside a `transact` callback fails at once with a message to use `tx`.
