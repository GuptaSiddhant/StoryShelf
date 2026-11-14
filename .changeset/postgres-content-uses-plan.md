---
"@storyshelf/db-postgres": patch
---

Fixed: recording and claiming content no longer run for minutes on a large build on Postgres (#1067)

`recordContentUses` looked up the size another use had recorded with a subquery per file. Planned from stale statistics (an analyze that saw only a few rows of one hash), that subquery scanned all of `content_uses` for each file, so publishing a build of tens of thousands of files could run for minutes. The sizes now come from one aggregate joined once.

The collector's claim had the same shape: one `UPDATE` over a subquery of the same table, which the planner could re-run per row. It now decides which hashes are claimable with a read and stamps them with a plain `UPDATE`, both under the same advisory locks.
