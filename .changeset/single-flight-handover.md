---
"@storyshelf/core": patch
---

Fixed: when a request for a single-flight key (a git-state notification, for example) arrived while its job ran, the job's end and the successor that serves that request are now one transaction. A crash can no longer end the job and lose the request; a database without transactions keeps the old two-step end. A request that arrives while a job's lease is exhausted is also served by a successor now, instead of failing to enqueue.
