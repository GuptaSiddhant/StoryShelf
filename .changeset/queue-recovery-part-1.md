---
"@storyshelf/core": patch
"@storyshelf/app": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Fixed: a capture job that loses its last lease can no longer leave its build stuck in `capturing`, and a late recovery can no longer fail a newer run (#259, #431, #432). A build now records the job that owns its current run (`builds.capture_job_id`, added by an additive migration that also backfills builds in flight), and the recovery hook only fails the build while that job still owns it. The job moves to a leased `exhausting` phase (shown as `recovering` in the queue views): if the hook throws or its instance dies, any instance re-runs it once the lease ends, up to five runs, and after that the job fails and admins get one `sys:capture-failed` alert. A late `done` and a cancel still win. The in-memory three-try retry of the hook is gone.
