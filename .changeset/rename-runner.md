---
"@storyshelf/runner": minor
---

Breaking: @storyshelf/runner-playwright is now @storyshelf/runner (createCaptureRunner, no aliases)

`@storyshelf/runner-playwright` is renamed `@storyshelf/runner` now that Playwright is the only runner. Every subpath (`@storyshelf/runner/remote`) and option is unchanged, and so are captures: no behaviour change and no new baseline. Nothing old is kept: `@storyshelf/runner-playwright` is not published again and `createPlaywrightCaptureRunner` is gone, so change your dependency and imports (see the upgrading guide). `server init` scaffolds `@storyshelf/runner`. Schema: none.
