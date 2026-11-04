---
"@storyshelf/core": patch
---

Fixed: a single-flight job that failed with a request waiting could start its successor twice when two instances settled it (an exhausted job whose hook run was taken over). The marker that records the waiting request is now cleared by one conditional write, and only the settler whose write cleared it starts the successor.
