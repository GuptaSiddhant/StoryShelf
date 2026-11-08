---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Add `testing.maxJobSeconds` (default 7200): a wall-clock bound for every job. Past it the job's lease is no longer renewed, its work is aborted through the `AbortSignal` its handler receives, and the normal retry or exhausted path takes over, so a hung job can no longer hold a slot forever. A capture that hits the bound ends its build `failed` and records `job deadline exceeded (<n>s)` in its attempt log.
