---
"@storyshelf/core": patch
---

Forked capture now forwards a shard run's repeated-work event from the worker child to the parent over IPC (a new `shard-repeated` message carrying counts only; a parent that does not know it ignores it), so the parent can count it.
