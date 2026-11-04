---
"@storyshelf/app": patch
"@storyshelf/core": patch
"storyshelf": patch
---

Fixed: an inline Storybook zip that is invalid or breaks an extraction cap now ends its build `failed` (with `build:failed` carrying the validation message), instead of leaving it `pending` forever. A git check already queued for the build resolves to a failure, and a later upload to that build answers `409`; run `storyshelf upload` again to create a new build. The CLI's `422` hint no longer offers to reuse the build.
