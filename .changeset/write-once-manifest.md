---
"@storyshelf/core": minor
"@storyshelf/app": minor
"@storyshelf/db-sqlite": minor
"@storyshelf/db-postgres": minor
"@storyshelf/db-mysql": minor
---

Changed: a build accepts one manifest; the same one again is a no-op, another is a 409 (#929)

`POST …/builds/:buildId/manifest` now claims the manifest in the new nullable `builds.manifest_sha256` before publishing. A failed publish releases the claim so a corrected manifest can be sent. Builds published before the column existed accept one more manifest.
