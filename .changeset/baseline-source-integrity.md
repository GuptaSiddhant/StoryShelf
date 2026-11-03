---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
---

Fixed: preparing baseline references no longer clears a baseline's recorded source build when the build row is gone (the source stays recorded and is counted as unavailable), and it now stops with a typed `BaselineSourceIntegrityError`, rolling everything back, when the source build is being deleted or belongs to another project. Preparation is not active in production yet.
