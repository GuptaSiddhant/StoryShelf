---
"@storyshelf/app": patch
---

Fixed: a re-upload shows the earlier verdict, and build rows count rejections

The review page now shows a read-only note when the latest earlier build on the branch approved or rejected the same story, mode and target, or left a change request open, with a link to that build (a cancelled or failed build has no verdict). The builds list row adds the rejected count.

Schema: none
