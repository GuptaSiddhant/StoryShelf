---
"@storyshelf/core": patch
"@storyshelf/app": patch
---

Fixed: `check-storage` also reports missing snapshot, baseline-copy and diff images

`storyshelf-server check-storage` now looks up the current, baseline-copy and diff image of every snapshot of an `available` build, reads builds and snapshots a page at a time, and exits 1 when one is missing. Before, a deleted diff image still reported "consistent".

Schema: none
