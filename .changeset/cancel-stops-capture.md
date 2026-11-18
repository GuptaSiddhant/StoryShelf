---
"@storyshelf/core": patch
---

Fixed: a cancelled build stops capturing and gives its worker slot back only once it has stopped

A cancel or a lost lease now aborts the job's signal, not only its deadline, including in a forked capture child. The capture checks it before every render pass, slice and target, and a pass the cancel ended is no longer treated as a crash to isolate and retry. The consumer keeps the job's slot until its handler has returned (at most 30 s, logged as `abandoned job stopped`, or as an error when it had to free the slot anyway).
