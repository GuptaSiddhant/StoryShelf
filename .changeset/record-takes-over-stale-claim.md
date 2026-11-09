---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
---

Fixed: an upload that shares a blob with a crashed collection pass no longer fails with a retry error until the next purge. Recording a build's use of shared content now clears a claim older than the collection lease and goes ahead; the stalled collector then finds it no longer holds the claim and deletes nothing. A claim still inside its lease keeps refusing.
