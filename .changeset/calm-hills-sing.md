---
"@storyshelf/core": patch
---

Affected capture no longer inherits a baseline that a later build promoted (for example by a per-snapshot approval while that build was still in review): the story is rendered again, so reverting it to the comparison build's version is not hidden.
