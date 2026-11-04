---
"@storyshelf/core": patch
---

Fixed: when a crashed shard's hook ran again after an earlier pass had already finalized the build but failed before closing its capture attempt, the retry returned "skipped" and left the attempt open forever. It now closes the plan's attempt (with the story and failed counts rebuilt from the plan and shards, without finalizing the build again) and reports "finalized"; a hook that arrives after a retry replaced the plan leaves the newer run's attempt alone.
