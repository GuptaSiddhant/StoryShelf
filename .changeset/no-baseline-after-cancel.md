---
"@storyshelf/core": patch
---

Fixed: a build cancelled while its stories were rendering can no longer move baselines. A capture-path baseline promotion is now refused when its build is `cancelled` or a retry has moved it to another capture generation (checked in the same transaction as the write where the database supports the reference lifecycle, right before it elsewhere), and finalize no longer drops the baselines of stories a cancelled run did not reach. Snapshots already written stay as diagnostic data.
