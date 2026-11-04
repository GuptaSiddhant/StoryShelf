---
"@storyshelf/app": patch
"@storyshelf/core": patch
---

Fixed: retrying a git channel's current state now says so when the open builds could not be looked up ("Couldn't look up open builds, try again", HTTP 503) instead of reporting that there was nothing to retry. The boot replay and origin-change replay keep their never-rejects behaviour.
