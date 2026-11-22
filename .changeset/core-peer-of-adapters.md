---
"@storyshelf/storage": minor
"@storyshelf/runner": minor
"@storyshelf/auth": minor
"@storyshelf/ai": minor
"@storyshelf/db": minor
---

Changed: `@storyshelf/core` is an exact peer dependency of the storage, runner, auth, ai and db packages

An adapter no longer installs its own `@storyshelf/core`: it requires the one you installed, at the same exact version, so a mismatched core is an install warning or error instead of a second copy. Add `@storyshelf/core` to your project's dependencies (`create-storyshelf` already writes it).
