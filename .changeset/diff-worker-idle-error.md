---
"@storyshelf/image": patch
---

Fixed: a diff worker message that answers no job no longer crashes the server. A `result` or `error` without a job id replaces that worker and fails only its own job; an answer for a job that is not in flight is reported and ignored; messages that are not the pool's (such as Node's `--watch` protocol) are ignored.
