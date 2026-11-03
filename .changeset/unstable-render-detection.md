---
"@storyshelf/core": minor
"@storyshelf/app": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

**Added: unstable render detection.** A snapshot that differs from its baseline is now rendered
once more in the same pass; when the two renders differ from each other it is flagged **Unstable
render: likely flaky** in review, with a pointer to ignore regions and `flakyTest`. The snapshot
stays a change to review and the build and git status are unchanged. New project setting **Detect
unstable renders** (`detectUnstable`, default on, under Settings → Tests) and a nullable
`unstable` field on snapshots; both databases gain a column (`snapshots.unstable`,
`projects.detect_unstable`) on startup. (#460)
