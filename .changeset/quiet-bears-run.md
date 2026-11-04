---
"@storyshelf/observability": patch
"@storyshelf/app": patch
---

Count the snapshots a shard captures again after a redelivery as the `storyshelf.capture.shard.repeated_snapshots` OpenTelemetry counter; it is a no-op without an SDK.
