---
"@storyshelf/core": patch
---

A shard that runs again after an earlier attempt had stored snapshots now says so: one attempt-log line on the build (`re-captured N snapshots an earlier attempt of shard S had already stored (attempt A of L)`), a structured log line, and a `shardRepeated` metrics hook on the consumer. Nothing is resumed or skipped; the earlier rows are still replaced.
