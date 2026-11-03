"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/db-postgres": patch
"@storyshelf/db-mysql": patch
---

Fixed: a capture enqueue that was slow to record its job could overwrite the run of a retry that completed meanwhile, leaving the retried build capturing. Builds now carry a run generation (`builds.capture_generation`, added by migration with default 0): a retry advances it, and an enqueue records its job only while the generation it read is current, otherwise its job is cancelled.
