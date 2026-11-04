---
"@storyshelf/core": patch
---

Fix: a capture job that waited for a forked child's slot, or was pushed to it again after a crash, is checked once more inside the capture handler right before it runs, so a run superseded by a retry in the meantime writes nothing.
