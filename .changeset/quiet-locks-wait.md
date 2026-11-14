---
"@storyshelf/db-sqlite": patch
---

Fixed: SQLite writes no longer fail with "database is locked" while a build is being retained or promoted

The adapter's connection waited for another connection's write lock with SQLite's `busy_timeout`, which sleeps the whole thread. The reference lifecycle holds that lock across awaits on the same event loop, so the wait could only end after five seconds in `database is locked`, and a capture lost the snapshot row it was saving (the build then ended `failed`). A statement now waits for the lock with the event loop free.

Schema: none.
