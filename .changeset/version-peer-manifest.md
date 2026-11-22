---
"create-storyshelf": minor
"@storyshelf/core": patch
---

Added: a generated version and peer manifest replaces the scaffold's hand-copied pins

`config/version-manifest.json` is built from every workspace `package.json` (versions, and the optional peers of each subpath with their ranges) and a test fails on drift. `create-storyshelf` writes `@storyshelf/*` at its own exact version and each SDK at the range its owner declares, which fixes the `@libsql/client`, `nodemailer` and `@aws-sdk/lib-storage` pins that had drifted. `mysql2` is no longer written: `@storyshelf/db-mysql` depends on it. `@storyshelf/core` is now always written explicitly. A test asserts that only `@storyshelf/core/test-helpers` resolves the optional `vitest` peer.
