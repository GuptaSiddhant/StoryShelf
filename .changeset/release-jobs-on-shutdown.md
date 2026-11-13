---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Changed: bound the SIGTERM drain and hand running jobs back without spending a retry (#912)

`teardown({ graceMs })` and `consumer.stop({ graceMs })` drain for up to the grace; a job still running after that is cancelled and handed back with the new queue operation `release`, which makes it claimable at once by another copy and does not count the attempt against `testing.retries`. The shipped servers read the grace from `SHUTDOWN_GRACE_SECONDS`; set it a few seconds below your platform's stop timeout. Unset, the drain still waits without a limit.
