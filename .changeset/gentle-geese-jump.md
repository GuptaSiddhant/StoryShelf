---
"@storyshelf/app": minor
"@storyshelf/core": minor
---

Review-request notifications are retried: on a long-running host each recipient of a build's review request is a `review-request` job on the notify queue, re-resolved when it runs and retried alone if the delivery is refused.
