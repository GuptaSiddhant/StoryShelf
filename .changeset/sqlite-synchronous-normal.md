---
"@storyshelf/db-sqlite": patch
---

Changed: SQLite syncs WAL writes with `synchronous = NORMAL`

The `node:sqlite`, `better-sqlite3` and `bun:sqlite` adapters now run `PRAGMA synchronous = NORMAL` beside WAL, so a commit no longer waits for an fsync. An application crash loses nothing; an OS crash or power loss can drop the last committed transactions but never corrupts the database. Pass `synchronous: "full"` to restore a sync on every commit. D1 and Turso are unaffected.
