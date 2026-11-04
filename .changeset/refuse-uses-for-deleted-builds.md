---
"@storyshelf/db-sqlite": patch
---

Fixed: recording a build's use of shared content now refuses a build that is gone or being deleted, so a publish that races a deletion can no longer pin shared blobs for good.
