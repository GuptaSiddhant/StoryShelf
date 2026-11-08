---
"@storyshelf/core": patch
"@storyshelf/db-sqlite": patch
"@storyshelf/app": patch
---

Added: on a file-backed SQLite database, the first boot after the upgrade records the content uses of builds published before `content_uses` existed, from their manifests, so their shared blobs can be collected once those builds are deleted. It runs in the background, keeps its progress, deletes nothing and skips any manifest value that is not a content hash.
