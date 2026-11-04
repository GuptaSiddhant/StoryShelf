---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Affected capture now compares against the newest earlier build on the branch that was approved, instead of any earlier build: a build still in review, or cancelled, failed or rejected, no longer hides its changes from the next build. With no approved build the capture is full.
