---
"@storyshelf/db-postgres": patch
---

Fixed: recording a build's content uses no longer scans the whole table once per file on Postgres (#1067)

`recordContentUses` looked up the size another use had recorded with a subquery per file. Planned from stale statistics (an analyze that saw only a few rows of one hash), that subquery scanned all of `content_uses` for each file, so publishing a build of tens of thousands of files could run for minutes. The sizes now come from one aggregate joined once.
