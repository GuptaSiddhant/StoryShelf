---
"@storyshelf/observability": patch
"@storyshelf/app": patch
---

Count stories a shard renders again after a redelivery as the `storyshelf.capture.shard.repeated_stories` OpenTelemetry counter; it is a no-op without an SDK.
