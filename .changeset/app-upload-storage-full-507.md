---
"@storyshelf/app": patch
---

Fixed: an upload to a full storage volume answers 507 and logs why, not a bare 500

A Storybook upload whose storage write fails with `ENOSPC` or `EDQUOT` (zip, content or manifest) now answers 507 with "The server's storage is full" in the error envelope, and the server logs the build, the step and the cause. Any other error keeps its current answer.
