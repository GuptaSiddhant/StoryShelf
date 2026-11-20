---
"@storyshelf/core": minor
"@storyshelf/app": minor
---

Changed: a bounded SIGTERM drain hands running jobs back without spending a retry

Minor, not patch: `CaptureConsumer.stop` and `lifecycle.teardown` take a new `graceMs` option, and a deploy or scale-in now ends differently. Before, a shutdown waited for the jobs in flight with no limit; the platform killed the process, the job's lease stayed held for up to `testing.leaseSeconds` (5 minutes by default), and the lost attempt counted against `testing.retries`.

With `teardown({ graceMs })` (hosts: `SHUTDOWN_GRACE_SECONDS`, a few seconds below the platform's stop timeout), each job still running when the grace runs out is stopped and handed back to the queue. Any instance can claim it at once, and its attempt count is unchanged. A job whose cancel was asked still ends `cancelled`, and a superseded holder's hand-back writes nothing. A job whose handler has not stopped by then is left to its lease, so no other instance runs it while it may still write. Without `graceMs`, teardown waits for every job, as before. The Fly host defaults to 3 s, under Fly's 5 s kill timeout. There is no schema change, and no new job kind or status value.
